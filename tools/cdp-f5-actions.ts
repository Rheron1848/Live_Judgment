/**
 * F5 快捷处置 CDP 验收：真实在播房间 + 登录态，点击面板处置按钮，
 * Fetch 层抓请求参数后一律 failRequest 阻断（请求不出网卡，绝不到达 B 站）。
 * F5 quick-actions CDP acceptance: click the panel's action buttons in a real live room,
 * capture request params at the Fetch layer, then failRequest everything (never reaches Bilibili).
 *
 * 用法 / Usage: bun tools/cdp-f5-actions.ts <roomBlancUrl>
 *   例 / e.g.: bun tools/cdp-f5-actions.ts "https://live.bilibili.com/blanc/21756924?liteVersion=true"
 * 前提 / Prerequisite: bun run build；Chrome 带 --remote-debugging-port=9222 + /tmp/lj-profile 登录副本。
 * 注意 / Note: 需要 blanc 直连 URL（CDP 注入覆盖不到房间页内嵌的 blanc iframe，见 README 踩坑）。
 */
import { readFileSync } from 'node:fs'

const roomUrl = process.argv[2]
if (!roomUrl) {
  console.error('usage: bun tools/cdp-f5-actions.ts <roomBlancUrl>')
  process.exit(1)
}

const CDP_HTTP = 'http://127.0.0.1:9222'
const script = readFileSync('dist/live-judgment.user.js', 'utf8')
const BLOCKED = [
  '*://*.bilivideo.com/*',
  '*://*.bilivideo.cn/*',
  '*://*.mcdn.bilivideo.cn/*',
  '*.m4s*',
  '*.flv*',
  '*.mp4*',
]
// 我们的三个写接口：抓到参数即阻断 / Our three write endpoints: capture params, then abort.
const WRITE_ENDPOINTS = ['/liveact/shield_user', '/x/relation/modify', '/banned/AddSilentUser']

interface CdpMessage {
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  sessionId?: string
}

const version = (await (await fetch(`${CDP_HTTP}/json/version`)).json()) as {
  webSocketDebuggerUrl: string
}
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve()
  ws.onerror = (e) => reject(e)
})

let nextId = 1
const pending = new Map<number, (v: CdpMessage) => void>()
const captured: string[] = []
const exceptions: string[] = []

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = nextId++
  return new Promise<CdpMessage>((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data)) as CdpMessage
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Fetch.requestPaused') {
    const p = msg.params as {
      requestId: string
      request: { url: string; method: string; postData?: string }
    }
    const hit = WRITE_ENDPOINTS.find((e) => p.request.url.includes(e))
    if (hit && p.request.method === 'POST') {
      // csrf 是登录凭据，日志里打码（只断言字段存在且两值一致）/ csrf is a credential; redact it in logs (only assert presence and equality).
      const body = (p.request.postData ?? '').replace(/(csrf(?:_token)?=)[^&]*/g, '$1<redacted>')
      const params = new URLSearchParams(p.request.postData ?? '')
      const csrfPairOk = !!params.get('csrf') && params.get('csrf') === params.get('csrf_token')
      captured.push(
        `${p.request.method} ${p.request.url}\n  BODY ${body}\n  csrf 双字段一致: ${csrfPairOk}`,
      )
      // 网卡前阻断，绝不到达 B 站 / Abort before the network stack; never reaches Bilibili.
      void send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Aborted' }, sessionId)
      return
    }
    void send('Fetch.continueRequest', { requestId: p.requestId }, sessionId)
    return
  }
  if (msg.method === 'Page.javascriptDialogOpening') {
    // confirm 一律接受 / Accept every confirm dialog.
    void send('Page.handleJavaScriptDialog', { accept: true }, sessionId)
    return
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const p = msg.params as {
      exceptionDetails: { text: string; exception?: { description?: string }; url?: string }
    }
    exceptions.push(
      `${p.exceptionDetails.text} ${p.exceptionDetails.exception?.description ?? ''} @${p.exceptionDetails.url ?? ''}`.slice(
        0,
        200,
      ),
    )
  }
}

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const targetId = (target as { targetId: string }).targetId
const { result: session } = await send('Target.attachToTarget', { targetId, flatten: true })
const sessionId = (session as { sessionId: string }).sessionId

await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)
await send('Network.setBlockedURLs', { urls: BLOCKED }, sessionId)
await send(
  'Fetch.enable',
  {
    patterns: [
      { urlPattern: '*://api.bilibili.com/*' },
      { urlPattern: '*://api.live.bilibili.com/*' },
    ],
  },
  sessionId,
)
await send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId)
await send(
  'Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  sessionId,
)

async function evalJs(expression: string): Promise<unknown> {
  const res = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  )
  const r = res.result as { result?: { value?: unknown }; exceptionDetails?: unknown }
  if (r?.exceptionDetails) return `EVAL_ERROR ${JSON.stringify(r.exceptionDetails).slice(0, 300)}`
  return r?.result?.value
}
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000))

/** 轮询页面表达式直到真值 / Poll an in-page expression until truthy. */
async function waitFor(expression: string, timeoutS: number): Promise<unknown> {
  const deadline = Date.now() + timeoutS * 1000
  while (Date.now() < deadline) {
    const v = await evalJs(expression)
    if (v) return v
    await sleep(2)
  }
  return null
}

/** 在面板 shadowRoot 里按文本点按钮 / Click a panel button by text inside the shadow root. */
async function clickPanelButton(text: string): Promise<unknown> {
  return evalJs(`(() => {
    const root = document.querySelector('#lj-panel-host')?.shadowRoot
    if (!root) return null
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === ${JSON.stringify(text)})
    if (!btn || btn.disabled) return null
    btn.click()
    return true
  })()`)
}

console.log(`navigate ${roomUrl}`)
await send('Page.navigate', { url: roomUrl }, sessionId)

// 1. 等徽章：判定徽章依赖引擎产出（不可控），改为确定性路径——抓一个活跃发言 uid 写进本地
// watchlist（纯本地 IDB），重载后脚本会给其弹幕补「人工」徽章，点徽章即开用户面板。
// Wait for a badge: verdict badges depend on engine output (uncontrollable), so use a deterministic
// path instead — write an active speaker into the local watchlist (local IDB only); after reload the
// script retro-marks their danmaku with a "人工" badge, and clicking it opens the user panel.
console.log('采样活跃发言用户（20s）...')
await sleep(20)
const activeUid = await evalJs(`(() => {
  const c = {}
  for (const el of document.querySelectorAll('.chat-item.danmaku-item')) {
    const u = Number(el.dataset.uid)
    if (u > 0) c[u] = (c[u] || 0) + 1
  }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]
  if (!top) return null
  const el = [...document.querySelectorAll('.chat-item.danmaku-item')].find((e) => Number(e.dataset.uid) === Number(top[0]))
  return JSON.stringify({ uid: Number(top[0]), uname: el?.dataset.uname || '', count: top[1] })
})()`)
if (!activeUid) {
  console.log('聊天区没有弹幕，放弃')
  ws.close()
  process.exit(2)
}
const sampled = JSON.parse(String(activeUid)) as { uid: number; uname: string; count: number }
console.log(
  `目标 uid=${sampled.uid}（${sampled.uname}，在屏 ${sampled.count} 条），写入 watchlist 并重载`,
)
await evalJs(`(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('live-judgment')
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const tx = db.transaction('watchlist', 'readwrite')
  tx.objectStore('watchlist').put({ uid: ${sampled.uid}, uname: ${JSON.stringify(sampled.uname)}, addedAt: Date.now(), fromRoomId: 0, note: 'cdp-f5-acceptance' })
  await new Promise((res, rej) => { tx.oncomplete = () => res(null); tx.onerror = () => rej(tx.error) })
  return 'ok'
})()`)
await send('Page.navigate', { url: roomUrl }, sessionId)

console.log('等待「人工」徽章出现（最多 60s）...')
const badge = await waitFor(
  `(() => {
    const b = document.querySelector('.lj-badge')
    return b ? b.dataset.ljUid : null
  })()`,
  60,
)
if (!badge) {
  console.log('没有徽章出现，无法打开用户面板，放弃')
  ws.close()
  process.exit(2)
}
const uid = Number(String(badge))
if (uid !== sampled.uid)
  console.log(
    `注意：徽章 uid=${uid} 与采样 uid=${sampled.uid} 不一致（可能先出了判定徽章），继续用徽章 uid`,
  )
console.log(`徽章 uid=${uid}，点击打开面板`)
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.lj-badge')].find((x) => Number(x.dataset.ljUid) === ${sampled.uid}) ?? document.querySelector('.lj-badge')
  b.click()
  return true
})()`)

const panelReady = await waitFor(
  `!!document.querySelector('#lj-panel-host')?.shadowRoot?.querySelector('.danmaku-report-panel, .card')`,
  10,
)
if (!panelReady) {
  console.log('面板未打开，放弃')
  ws.close()
  process.exit(2)
}
console.log('面板已打开')

// 2. 官方屏蔽（双动作幂等模式，断言 shield_user type=1；type=0 由单测覆盖）。
// 用户视图异步渲染，先等按钮出现再点 / The user view renders async; wait for the button before clicking.
console.log('\n--- 官方屏蔽 ---')
await waitFor(
  `(() => {
    const root = document.querySelector('#lj-panel-host')?.shadowRoot
    if (!root) return null
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === '官方屏蔽')
    return btn && !btn.disabled ? true : null
  })()`,
  15,
)
await clickPanelButton('官方屏蔽')
await sleep(2)

// 3. 拉黑（等状态查询返回后再点；查询是只读 GET，放行）。
console.log('\n--- 拉黑 ---')
await waitFor(
  `(() => {
    const root = document.querySelector('#lj-panel-host')?.shadowRoot
    if (!root) return null
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === '拉黑' || b.textContent?.trim() === '解除拉黑')
    return btn && !btn.disabled ? btn.textContent.trim() : null
  })()`,
  15,
)
const blockLabel = String(
  (await evalJs(`(() => {
    const root = document.querySelector('#lj-panel-host')?.shadowRoot
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === '拉黑' || b.textContent?.trim() === '解除拉黑')
    return btn ? btn.textContent.trim() : ''
  })()`)) ?? '',
)
console.log(`拉黑按钮文案: ${blockLabel}`)
if (blockLabel) await clickPanelButton(blockLabel)
await sleep(2)

// 4. 禁言（需房管；此处只验证请求构造）。
console.log('\n--- 禁言（需房管） ---')
await clickPanelButton('禁言')
await sleep(2)

// 5. 举报选中弹幕（驱动官方面板，不提交）。
console.log('\n--- 举报选中弹幕 ---')
await clickPanelButton('举报选中弹幕')
await sleep(3)
const reportPanel = await evalJs(`(() => {
  const p = document.querySelector('.danmaku-report-panel')
  return p ? (p.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200) : null
})()`)
console.log(`官方举报面板: ${reportPanel ?? '未出现'}`)

// 6. 面板上的错误透传证据（被阻断的请求应显示 fetch 错误，不静默）。
const actionMsg = await evalJs(`(() => {
  const root = document.querySelector('#lj-panel-host')?.shadowRoot
  if (!root) return null
  const mutes = [...root.querySelectorAll('.muted')].map((e) => e.textContent?.trim()).filter(Boolean)
  return JSON.stringify(mutes.slice(-2))
})()`)
console.log(`面板错误透传: ${actionMsg}`)

console.log('\n=== 抓到的写请求（已全部在网卡前阻断） ===')
for (const c of captured) console.log(c)
console.log(`\n=== 页面异常（去重） ===`)
for (const e of [...new Set(exceptions)].slice(0, 5)) console.log(e)
if (exceptions.length === 0) console.log('(none)')

await send('Target.closeTarget', { targetId })
ws.close()
process.exit(0)
