import type { DanmakuEvent } from './types'

/**
 * 弹幕来源抽象：检测与展示模块只依赖本接口，不关心底层是 DOM 还是 WebSocket。
 * Danmaku source abstraction: downstream modules depend only on this interface.
 */
export interface DanmakuSource {
  /** 启动监听，返回清理函数 / Start listening; returns a cleanup function. */
  start(onMessage: (event: DanmakuEvent) => void): () => void
}
