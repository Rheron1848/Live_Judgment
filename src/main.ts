import { createDomChatSource } from './lib/dom-chat-source'
import { parseRoomId } from './lib/room'

const roomId = parseRoomId(location.pathname)
if (roomId === null) {
  // 非直播间页面（如首页），静默退出 / Not a live-room page (e.g. index); exit silently.
} else {
  const source = createDomChatSource(roomId)
  source.start((event) => {
    // 临时验证输出，检测模块接入后移除 / Temporary verification output; remove once the detection pipeline lands.
    console.log('[LiveJudgment]', event.uid, event.uname, event.text)
  })
}
