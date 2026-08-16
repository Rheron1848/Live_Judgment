import type { UserVerdict } from '../detect/verdict'
import { badgesForVerdict } from './badge'

const STYLE_ID = 'lj-marker-style'
const ITEM_SELECTOR = '.chat-item.danmaku-item'

// 行内徽章，10px 字号不抢聊天区布局；样式集中在此一处注入。
// Inline badges at 10px to leave the chat layout alone; styles injected once from here.
const CSS = `
.lj-badges { display: inline-flex; gap: 2px; margin-right: 4px; vertical-align: middle; }
.lj-badge { display: inline-block; padding: 0 3px; border-radius: 3px; font-size: 10px; line-height: 14px; color: #fff; cursor: help; user-select: none; }
.lj-badge--soft { opacity: 0.55; }
`

/** 注入徽章样式（幂等）/ Inject badge styles (idempotent). */
export function ensureStyle(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.appendChild(style)
}

/** 在弹幕节点插入/更新徽章（幂等，判定升级时刷新内容）/ Insert or update badges on a chat item (idempotent; refreshes on verdict upgrades). */
export function markElement(el: HTMLElement, verdict: UserVerdict): void {
  const doc = el.ownerDocument
  ensureStyle(doc)

  let container = el.querySelector<HTMLElement>(':scope > .lj-badges')
  if (!container) {
    container = doc.createElement('span')
    container.className = 'lj-badges'
    el.prepend(container)
  }

  container.replaceChildren(
    ...badgesForVerdict(verdict).map((spec) => {
      const badge = doc.createElement('span')
      badge.className = spec.solid ? 'lj-badge' : 'lj-badge lj-badge--soft'
      badge.style.backgroundColor = spec.color
      badge.textContent = spec.label
      badge.title = spec.title
      return badge
    }),
  )
}

/** 补标某用户在屏的旧弹幕 / Retro-mark a user's messages already present in the chat area. */
export function markExisting(uid: number, verdict: UserVerdict, root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>(`${ITEM_SELECTOR}[data-uid="${uid}"]`)) {
    markElement(el, verdict)
  }
}
