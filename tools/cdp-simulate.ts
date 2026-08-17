/**
 * CDP 合成弹幕冒烟测试：往聊天容器注入仿 B 站结构的弹幕节点，验证 观察器→检测→徽章→落库 全链路。
 * CDP synthetic-danmaku smoke test: inject Bilibili-structured chat nodes to drive
 * the full observer → detection → badge → persistence pipeline.
 *
 * 用法 / Usage: bun tools/cdp-simulate.ts <roomUrl>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const roomUrl = process.argv[2]
if (!roomUrl) {
  console.error('usage: bun tools/cdp-simulate.ts <roomUrl>')
  process.exit(1)
}

const script = readFileSync('dist/live-judgment.user.js', 'utf8')

const version = (await (await fetch('http://127.0.0.1:9222/json/version')).json()) as {
  webSocketDebuggerUrl: string
}
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve()
  ws.onerror = (e) => reject(e)
})

let nextId = 1
const pending = new Map<number, (v: { result?: Record<string, unknown> }) => void>()
ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown> }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  }
}
function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = nextId++
  return new Promise<{ result?: Record<string, unknown> }>((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}
async function evaluate(expression: string, sessionId: string): Promise<unknown> {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true }, sessionId)
  return (res.result as { result?: { value?: unknown } })?.result?.value
}

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: session } = await send('Target.attachToTarget', {
  targetId: (target as { targetId: string }).targetId,
  flatten: true,
})
const sessionId = (session as { sessionId: string }).sessionId
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)
await send(
  'Network.setBlockedURLs',
  { urls: ['*://*.bilivideo.com/*', '*://*.bilivideo.cn/*', '*.m4s*', '*.flv*', '*.mp4*'] },
  sessionId,
)
await send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId)
await send('Page.navigate', { url: roomUrl }, sessionId)

// 等聊天容器出现（至多 90s）；标准房间在顶层文档，赛事页在 blanc iframe 里。
// Wait for the chat container (up to 90s); standard rooms have it in the top document, event pages in a blanc iframe.
const CHAT_DOC = `(() => {
  if (document.querySelector('.chat-items')) return document
  const f = [...document.querySelectorAll('iframe')].find((i) => i.src.includes('/blanc/'))
  const d = f?.contentDocument
  return d?.querySelector('.chat-items') ? d : null
})()`
const FIND_CONTAINER = `!!(${CHAT_DOC})`
let containerReady = false
for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  if (await evaluate(FIND_CONTAINER, sessionId)) {
    containerReady = true
    break
  }
}
if (!containerReady) {
  console.log('FAIL: 聊天容器 90s 内未出现')
  process.exit(1)
}
console.log('chat container ready, injecting synthetic danmaku...')

// 注入合成弹幕：uid 900001 贴限速复读 ×5（D1），uid 900002 发含 U+00AD 的单条（D2）。
// Inject synthetic danmaku: uid 900001 repeat-spams ×5 at the rate-limit floor (D1),
// uid 900002 sends one message containing U+00AD (D2).
const INJECT = `(() => {
  const doc = ${CHAT_DOC}
  const container = doc.querySelector('.chat-items')
  const sendMsg = (uid, uname, text) => {
    const d = doc.createElement('div')
    d.className = 'chat-item danmaku-item'
    d.dataset.uid = String(uid)
    d.dataset.uname = uname
    d.dataset.danmaku = text
    container.appendChild(d)
  }
  sendMsg(900002, 'judge-d2', '证据­样本')
  for (let i = 0; i < 5; i++) {
    setTimeout(() => sendMsg(900001, 'judge-d1', '独轮车样本'), i * 1010)
  }
  return 'injected'
})()`
console.log(await evaluate(INJECT, sessionId))

// 等检测与落库完成（5 条发完约 5s，缓冲 flush 2s，余量到 15s）/ Wait for detection and persistence (messages ~5s, buffer flush 2s, margin to 15s).
await new Promise((r) => setTimeout(r, 15000))

const PROBE = `(async () => {
  const doc = ${CHAT_DOC}
  const badgeInfo = [...doc.querySelectorAll('.lj-badge')].map((b) => ({
    text: b.textContent,
    uid: b.dataset.ljUid,
    title: b.title.split('\\n')[0],
  }))
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('live-judgment')
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  const count = (store) =>
    new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).count()
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
  return JSON.stringify({
    chatItems: doc.querySelectorAll('.chat-item').length,
    badges: badgeInfo,
    danmakuStored: await count('danmaku'),
    incidentsStored: await count('incidents'),
  })
})()`
console.log('=== probe ===')
console.log(JSON.stringify(JSON.parse(String(await evaluate(PROBE, sessionId))), null, 2))

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync(
  '/tmp/lj-sim.png',
  Buffer.from(String((shot.result as { data?: string })?.data ?? ''), 'base64'),
)
console.log('screenshot: /tmp/lj-sim.png')

ws.close()
process.exit(0)
