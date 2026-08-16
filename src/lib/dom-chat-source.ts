import type { DanmakuSource } from './danmaku-source'
import type { DanmakuEvent } from './types'

// 聊天容器与弹幕节点都是 B 站页面内部结构，改版会失效——选择器集中在此，便于一处修复。
// Selectors target Bilibili's internal DOM and may break on site updates; keep them in one place.
const CONTAINER_SELECTOR = '.chat-items'
const ITEM_SELECTOR = '.chat-item.danmaku-item'

/** 从弹幕节点提取事件，缺关键字段时返回 null / Extract an event from a chat item node; null when key fields are missing. */
function parseItem(el: HTMLElement, roomId: number): DanmakuEvent | null {
  const text = el.dataset.danmaku
  const uid = Number(el.dataset.uid)
  if (!text || !Number.isFinite(uid) || uid <= 0) return null
  return {
    uid,
    uname: el.dataset.uname ?? '',
    text,
    ts: Date.now(),
    roomId,
    el,
  }
}

/** 基于页面聊天区 DOM 的弹幕来源 / Danmaku source backed by the page's chat-area DOM. */
export function createDomChatSource(roomId: number): DanmakuSource {
  return {
    start(onMessage) {
      let itemObserver: MutationObserver | null = null

      const attach = (container: Element) => {
        itemObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (!(node instanceof HTMLElement) || !node.matches(ITEM_SELECTOR)) continue
              const event = parseItem(node, roomId)
              if (event) onMessage(event)
            }
          }
        })
        itemObserver.observe(container, { childList: true })
      }

      const existing = document.querySelector(CONTAINER_SELECTOR)
      if (existing) {
        attach(existing)
        return () => itemObserver?.disconnect()
      }

      // 聊天区可能晚于脚本加载出现，先盯根元素等容器挂载。
      // document.body 在 document-start 时序下可能为 null，退到 documentElement。
      // The chat area may mount after the script; watch the root element until the container appears.
      // document.body can be null at document-start, so fall back to documentElement.
      const waitObserver = new MutationObserver(() => {
        const container = document.querySelector(CONTAINER_SELECTOR)
        if (!container) return
        waitObserver.disconnect()
        attach(container)
      })
      waitObserver.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
      })

      return () => {
        waitObserver.disconnect()
        itemObserver?.disconnect()
      }
    },
  }
}
