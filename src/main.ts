import { createDetectionEngine } from './lib/detect/engine'
import { createDomChatSource } from './lib/dom-chat-source'
import { parseRoomId } from './lib/room'

const roomId = parseRoomId(location.pathname)
if (roomId === null) {
  // 非直播间页面（如首页），静默退出 / Not a live-room page (e.g. index); exit silently.
} else {
  const engine = createDetectionEngine()
  // 临时验证输出，F3 标记渲染落地后移除 / Temporary verification output; remove once F3 marker rendering lands.
  engine.onVerdict((verdict) => console.log('[LiveJudgment] verdict', JSON.stringify(verdict)))

  const source = createDomChatSource(roomId)
  source.start((event) => engine.ingest(event))
}
