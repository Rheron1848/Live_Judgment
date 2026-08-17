import type { BlockWordMatcher } from '../blockword/matcher'
import { ensureStyle } from './marker'

const HIDDEN_CLASS = 'lj-hidden'
const ITEM_SELECTOR = '.chat-item.danmaku-item'

/** 本地隐藏命中屏蔽词的弹幕节点（样式由 marker.ts 注入）/ Locally hide a danmaku node that hits a block word (styles injected by marker.ts). */
export function hideElement(el: HTMLElement): void {
  ensureStyle(el.ownerDocument)
  el.classList.add(HIDDEN_CLASS)
}

/** 恢复被隐藏的弹幕节点 / Unhide a previously hidden danmaku node. */
export function unhideElement(el: HTMLElement): void {
  el.classList.remove(HIDDEN_CLASS)
}

/** 词条变更后按 data-danmaku 重读文本逐条重判：隐藏新命中的，恢复不再命中的。
 *  Re-judge on-screen items by their data-danmaku text after entries change: hide new hits, restore the rest. */
export function reapplyHiding(matcher: BlockWordMatcher, root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
    const text = el.dataset.danmaku
    if (text && matcher.test(text)) hideElement(el)
    else unhideElement(el)
  }
}
