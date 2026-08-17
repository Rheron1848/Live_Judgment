/**
 * CDP API 探针：在已登录的直播间页面上下文里调 B 站接口，打印响应（用于接口侦察）。
 * CDP API probe: call Bilibili APIs from a logged-in live-room page context (for endpoint recon).
 *
 * 用法 / Usage: bun tools/cdp-api-probe.ts <apiPath> [apiPath...]
 * 例 / e.g.: bun tools/cdp-api-probe.ts "/xlive/web-ucenter/v1/banned/GetShieldKeyword?roomid=510"
 */
const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: bun tools/cdp-api-probe.ts <apiPath> [...]')
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
await send('Page.navigate', { url: 'https://live.bilibili.com/510' }, sessionId)
// 等页面建立登录上下文 / Wait for the page to establish the logged-in context.
await new Promise((r) => setTimeout(r, 10000))

for (const path of paths) {
  const res = await send(
    'Runtime.evaluate',
    {
      expression: `fetch('https://api.live.bilibili.com${path}', { credentials: 'include' }).then((r) => r.text()).then((t) => t.slice(0, 1200)).catch((e) => 'FETCH_ERROR: ' + e)`,
      awaitPromise: true,
    },
    sessionId,
  )
  const value = (res.result as { result?: { value?: unknown } })?.result?.value
  console.log(`=== ${path} ===`)
  console.log(value ?? '(no result)')
  console.log()
}

ws.close()
process.exit(0)
