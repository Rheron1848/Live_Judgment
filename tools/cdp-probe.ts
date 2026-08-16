/**
 * CDP 探针：打开页面，等待后输出 DOM 诊断并截图到 /tmp/lj-page.png。
 * CDP probe: open a page, wait, dump DOM diagnostics, and screenshot to /tmp/lj-page.png.
 *
 * 用法 / Usage: bun tools/cdp-probe.ts <url> [seconds]
 */
import { writeFileSync } from 'node:fs'

const url = process.argv[2]
const seconds = Number(process.argv[3] ?? 60)
if (!url) {
  console.error('usage: bun tools/cdp-probe.ts <url> [seconds]')
  process.exit(1)
}

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

const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
const { result: session } = await send('Target.attachToTarget', {
  targetId: (target as { targetId: string }).targetId,
  flatten: true,
})
const sessionId = (session as { sessionId: string }).sessionId
await send('Page.enable', {}, sessionId)
await send('Network.enable', {}, sessionId)
await send('Network.setBlockedURLs', { urls: ['*://*.bilivideo.com/*', '*://*.bilivideo.cn/*', '*.m4s*', '*.flv*', '*.mp4*'] }, sessionId)
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId)
await send('Page.navigate', { url }, sessionId)
console.log(`waiting ${seconds}s...`)
await new Promise((r) => setTimeout(r, seconds * 1000))

const DIAG = `(() => {
  const f = [...document.querySelectorAll('iframe')].find((i) => i.src.includes('/blanc/'))
  const doc = f?.contentDocument
  const classSample = doc
    ? [...doc.querySelectorAll('[class]')].slice(0, 400).map((e) => e.className).join(' ').match(/[\\w-]*chat[\\w-]*/gi)
    : null
  return JSON.stringify({
    title: document.title,
    readyState: document.readyState,
    iframeReadyState: doc?.readyState ?? null,
    iframeBodyChildren: doc?.body?.children.length ?? -1,
    chatItems: doc?.querySelector('.chat-items') !== null,
    chatItemCount: doc?.querySelectorAll('.chat-item').length ?? -1,
    chatClasses: classSample ? [...new Set(classSample)].slice(0, 20) : null,
    iframeText: (doc?.body?.innerText ?? '').slice(0, 200),
  })
})()`
const diag = await send('Runtime.evaluate', { expression: DIAG }, sessionId)
console.log('=== diagnostics ===')
console.log(JSON.stringify(JSON.parse(String((diag.result as { result?: { value?: string } })?.result?.value ?? '{}')), null, 2))

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
writeFileSync('/tmp/lj-page.png', Buffer.from(String((shot.result as { data?: string })?.data ?? ''), 'base64'))
console.log('screenshot: /tmp/lj-page.png')

ws.close()
process.exit(0)
