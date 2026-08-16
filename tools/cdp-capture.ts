/**
 * CDP 调试工具：无头 Chrome 打开直播间，屏蔽视频流，注入构建产物，捕获控制台输出。
 * CDP debug tool: open a live room in headless Chrome with video streams blocked,
 * inject the built userscript, and capture console output.
 *
 * 用法 / Usage: bun tools/cdp-capture.ts <roomUrl> [seconds]
 * 前提 / Prerequisite: Chrome 已带 --remote-debugging-port=9222 启动。
 */
import { readFileSync } from 'node:fs'

const roomUrl = process.argv[2]
const seconds = Number(process.argv[3] ?? 90)
if (!roomUrl) {
  console.error('usage: bun tools/cdp-capture.ts <roomUrl> [seconds]')
  process.exit(1)
}

const CDP_HTTP = 'http://127.0.0.1:9222'
const script = readFileSync('dist/live-judgment.user.js', 'utf8')

// 屏蔽视频/媒体流：聊天 DOM 与弹幕 websocket 不受影响，视频不下载不解码。
// Block video/media streams: chat DOM and the danmaku websocket are unaffected.
const BLOCKED = [
  '*://*.bilivideo.com/*',
  '*://*.bilivideo.cn/*',
  '*://*.mcdn.bilivideo.cn/*',
  '*.m4s*',
  '*.flv*',
  '*.mp4*',
]

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
const consoleLines: string[] = []
const exceptions: string[] = []

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = nextId++
  return new Promise<CdpMessage>((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

function fmtArgs(args: unknown): string {
  if (!Array.isArray(args)) return ''
  return args
    .map((a) => {
      const obj = a as { value?: unknown; description?: string; type?: string }
      return obj.value !== undefined ? String(obj.value) : (obj.description ?? obj.type ?? '')
    })
    .join(' ')
    .slice(0, 500)
}

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data)) as CdpMessage
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const p = msg.params as { type: string; args: unknown }
    consoleLines.push(`[console.${p.type}] ${fmtArgs(p.args)}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const p = msg.params as {
      exceptionDetails: {
        text: string
        exception?: { description?: string }
        url?: string
        lineNumber?: number
      }
    }
    const d = p.exceptionDetails
    exceptions.push(
      `${d.text} ${d.exception?.description ?? ''} @${d.url ?? ''}:${d.lineNumber ?? ''}`,
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
await send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId)
await send('Page.navigate', { url: roomUrl }, sessionId)

console.log(`capturing ${seconds}s on ${roomUrl} (video streams blocked)`)
await new Promise((r) => setTimeout(r, seconds * 1000))

// 收尾探针：确认脚本在页内活着。标准房间聊天区在顶层文档，赛事页在 blanc iframe 里，两种都要兼容。
// Final probe: chat lives in the top document for standard rooms and in a blanc iframe for event pages.
const probe = await send(
  'Runtime.evaluate',
  {
    expression: `(async () => {
      const doc = (() => {
        if (document.querySelector('.chat-items')) return document
        const f = [...document.querySelectorAll('iframe')].find((i) => i.src.includes('/blanc/'))
        const d = f?.contentDocument
        return d?.querySelector('.chat-items') ? d : null
      })()
      if (!doc) return JSON.stringify({ container: false })
      const db = await new Promise((res, rej) => {
        const req = indexedDB.open('live-judgment')
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      }).catch(() => null)
      const count = (store) =>
        new Promise((res) => {
          const req = db.transaction(store, 'readonly').objectStore(store).count()
          req.onsuccess = () => res(req.result)
          req.onerror = () => res(-1)
        })
      return JSON.stringify({
        container: true,
        chatItems: doc.querySelectorAll('.chat-item').length,
        badges: doc.querySelectorAll('.lj-badge').length,
        danmakuStored: db ? await count('danmaku') : -1,
        incidentsStored: db ? await count('incidents') : -1,
      })
    })()`,
    awaitPromise: true,
  },
  sessionId,
)
const probeValue = (probe.result as { result?: { value?: string } })?.result?.value

console.log('\n=== probe ===')
console.log(probeValue ?? '(no result)')
console.log(`\n=== exceptions (${exceptions.length}) ===`)
for (const e of [...new Set(exceptions)]) console.log(e)
console.log(`\n=== console lines (${consoleLines.length}, dedup) ===`)
const counts = new Map<string, number>()
for (const line of consoleLines) counts.set(line, (counts.get(line) ?? 0) + 1)
for (const [line, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`x${n} ${line}`)
}

ws.close()
process.exit(0)
