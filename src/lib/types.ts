/** 一条弹幕事件 / A single danmaku event. */
export interface DanmakuEvent {
  /** 发送者 uid，解析失败为 0 / Sender uid; 0 when unparseable. */
  uid: number
  /** 发送者昵称 / Sender nickname. */
  uname: string
  /** 弹幕原文 / Raw message text. */
  text: string
  /** 本地捕获时刻（ms），非平台时间戳 / Local capture time in ms, not the platform timestamp. */
  ts: number
  /** 房间号 / Room id. */
  roomId: number
  /** 来源 DOM 节点，供标记渲染回指 / Source DOM node, for later marker rendering. */
  el?: HTMLElement
}
