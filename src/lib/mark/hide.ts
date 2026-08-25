import type { BlockWordMatcher } from '../blockword/matcher'
import type { F6Mode } from '../settings/config'
import { ensureStyle } from './marker'

const HIDDEN_CLASS = 'lj-hidden'
const HIGHLIGHT_CLASS = 'lj-highlight'
const ITEM_SELECTOR = '.chat-item.danmaku-item'

/** 本地隐藏命中屏蔽词的弹幕节点（样式由 marker.ts 注入）/ Locally hide a danmaku node that hits a block word (styles injected by marker.ts). */
export function hideElement(el: HTMLElement): void {
  ensureStyle(el.ownerDocument)
  el.classList.remove(HIGHLIGHT_CLASS)
  el.classList.add(HIDDEN_CLASS)
}

/** 高亮命中屏蔽词的弹幕节点（F6 高亮模式）/ Highlight a danmaku node that hits a block word (F6 highlight mode). */
export function highlightElement(el: HTMLElement): void {
  ensureStyle(el.ownerDocument)
  el.classList.remove(HIDDEN_CLASS)
  el.classList.add(HIGHLIGHT_CLASS)
}

/** 清除弹幕节点上的本地隐藏/高亮标记 / Clear local hide/highlight marks from a danmaku node. */
export function unhideElement(el: HTMLElement): void {
  el.classList.remove(HIDDEN_CLASS)
  el.classList.remove(HIGHLIGHT_CLASS)
}

/** 词条或屏蔽名单变更后逐条重判在屏弹幕：uid 命中屏蔽名单始终隐藏；文本命中屏蔽词按 mode 隐藏或高亮；其余恢复。
 *  Re-judge on-screen items after block words or user mutes change: muted uids always hide;
 *  block-word text hits hide or highlight per mode; the rest are restored. */
export function reapplyHiding(
  matcher: BlockWordMatcher,
  isUidMuted: (uid: number) => boolean,
  mode: F6Mode = 'hide',
  root: ParentNode = document,
): void {
  for (const el of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
    const text = el.dataset.danmaku
    const uid = Number(el.dataset.uid)
    if (Number.isFinite(uid) && isUidMuted(uid)) {
      hideElement(el)
    } else if (text && matcher.test(text)) {
      if (mode === 'hide') hideElement(el)
      else highlightElement(el)
    } else {
      unhideElement(el)
    }
  }
}
