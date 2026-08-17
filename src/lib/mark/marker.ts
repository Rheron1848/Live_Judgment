import type { UserVerdict } from '../detect/verdict'
import type { WatchlistEntry } from '../store/watchlist'
import { badgesForVerdict } from './badge'

const STYLE_ID = 'lj-marker-style'
const ITEM_SELECTOR = '.chat-item.danmaku-item'

// 行内徽章，10px 字号不抢聊天区布局；样式集中在此一处注入。
// Inline badges at 10px to leave the chat layout alone; styles injected once from here.
const CSS = `
.lj-badges { display: inline-flex; gap: 2px; margin-right: 4px; vertical-align: middle; }
.lj-badge { display: inline-block; padding: 0 3px; border-radius: 3px; font-size: 10px; line-height: 14px; color: #fff; cursor: help; user-select: none; }
.lj-badge--soft { opacity: 0.55; }
.lj-hidden { display: none !important; }
`

/** 注入徽章样式（幂等）/ Inject badge styles (idempotent). */
export function ensureStyle(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.appendChild(style)
}

// 徽章容器分自动/人工两个槽位，互不覆盖（判定升级刷自动槽，名单标记刷人工槽）。
// The badge container has separate auto/manual slots so updates never clobber each other.
function slotOf(el: HTMLElement, slot: 'auto' | 'manual'): HTMLElement {
  const doc = el.ownerDocument
  let container = el.querySelector<HTMLElement>(':scope > .lj-badges')
  if (!container) {
    container = doc.createElement('span')
    container.className = 'lj-badges'
    el.prepend(container)
  }
  let s = container.querySelector<HTMLElement>(`[data-lj-slot="${slot}"]`)
  if (!s) {
    s = doc.createElement('span')
    s.dataset.ljSlot = slot
    container.appendChild(s)
  }
  return s
}

/** 在弹幕节点插入/更新检测徽章（幂等，判定升级时刷新内容）/ Insert or update detection badges on a chat item (idempotent; refreshes on verdict upgrades). */
export function markElement(el: HTMLElement, verdict: UserVerdict): void {
  ensureStyle(el.ownerDocument)
  const slot = slotOf(el, 'auto')
  slot.replaceChildren(
    ...badgesForVerdict(verdict).map((spec) => {
      const badge = el.ownerDocument.createElement('span')
      badge.className = spec.solid ? 'lj-badge' : 'lj-badge lj-badge--soft'
      badge.style.backgroundColor = spec.color
      badge.textContent = spec.label
      badge.title = spec.title
      badge.dataset.ljUid = String(verdict.uid)
      return badge
    }),
  )
}

/** 在弹幕节点插入/更新人工名单徽章 / Insert or update the manual-watchlist badge on a chat item. */
export function markManual(el: HTMLElement, entry: WatchlistEntry): void {
  const doc = el.ownerDocument
  ensureStyle(doc)
  const slot = slotOf(el, 'manual')
  const badge = doc.createElement('span')
  badge.className = 'lj-badge'
  badge.style.backgroundColor = '#1e88e5'
  badge.textContent = '人工'
  const added = new Date(entry.addedAt).toLocaleString()
  badge.title = `人工标记\n加入于 ${added}${entry.note ? `\n备注：${entry.note}` : ''}`
  badge.dataset.ljUid = String(entry.uid)
  slot.replaceChildren(badge)
}

/** 清掉某用户在屏弹幕的人工徽章（移出名单时调用）/ Remove manual badges from a user's on-screen messages (when unwatching). */
export function unmarkManual(uid: number, root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(`${ITEM_SELECTOR}[data-uid="${uid}"]`)) {
    el.querySelector('[data-lj-slot="manual"]')?.replaceChildren()
  }
}

/** 补标某用户在屏的旧弹幕（检测徽章）/ Retro-mark a user's on-screen messages (detection badges). */
export function markExisting(uid: number, verdict: UserVerdict, root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(`${ITEM_SELECTOR}[data-uid="${uid}"]`)) {
    markElement(el, verdict)
  }
}

/** 补标名单用户在屏的旧弹幕（人工徽章）/ Retro-mark a watchlisted user's on-screen messages. */
export function markManualExisting(entry: WatchlistEntry, root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(
    `${ITEM_SELECTOR}[data-uid="${entry.uid}"]`,
  )) {
    markManual(el, entry)
  }
}
