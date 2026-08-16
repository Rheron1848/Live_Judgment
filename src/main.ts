import { createDetectionEngine } from './lib/detect/engine'
import { createDomChatSource } from './lib/dom-chat-source'
import { markElement, markExisting } from './lib/mark/marker'
import { parseRoomId } from './lib/room'

const roomId = parseRoomId(location.pathname)
if (roomId !== null) {
  const engine = createDetectionEngine()

  engine.onVerdict((verdict) => {
    // 调试用日志，设置面板落地后改为可选 / Debug log; make optional once the settings panel lands.
    console.log('[LiveJudgment] verdict', JSON.stringify(verdict))
    markExisting(verdict.uid, verdict)
  })

  const source = createDomChatSource(roomId)
  source.start((event) => {
    engine.ingest(event)
    if (!event.el) return
    const verdict = engine.getVerdict(event.uid)
    if (verdict) markElement(event.el, verdict)
  })
}
