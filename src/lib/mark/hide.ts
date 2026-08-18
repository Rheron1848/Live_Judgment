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

/** 词条或屏蔽名单变更后逐条重判在屏弹幕：文本命中屏蔽词或 uid 命中屏蔽名单即隐藏，否则恢复。
 *  Re-judge on-screen items after block words or user mutes change: hide on a text hit or a muted uid, restore the rest. */
export function reapplyHiding(
  matcher: BlockWordMatcher,
  isUidMuted: (uid: number) => boolean,
  root: ParentNode = document,
): void {
  for (const el of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
    const text = el.dataset.danmaku
    const uid = Number(el.dataset.uid)
    if ((text && matcher.test(text)) || (Number.isFinite(uid) && isUidMuted(uid))) hideElement(el)
    else unhideElement(el)
  }
}
