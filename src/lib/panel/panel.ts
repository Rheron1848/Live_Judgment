import { resolveAnchorName } from '../store/anchor'
import type { BlockWordEntry } from '../store/blockwords'
import { danmakuByUid } from '../store/danmaku'
import { clearIncidents, deleteIncidentsByUid, incidentsByUid } from '../store/incidents'
import type { UserMuteEntry } from '../store/usermutes'
import type { WatchlistEntry } from '../store/watchlist'
import { buildUserViewModel, type IncidentView, type UserViewModel } from './view-model'

/** 面板依赖，由 main.ts 装配 / Panel dependencies, wired by main.ts. */
export interface PanelContext {
  db: IDBDatabase | null
  currentRoomId: number
  getWatchlistEntry(uid: number): WatchlistEntry | undefined
  listWatchlist(): WatchlistEntry[]
  addWatch(entry: WatchlistEntry): Promise<void>
  removeWatch(uid: number): Promise<void>
  listBlockWords(): BlockWordEntry[]
  addBlockWord(entry: BlockWordEntry): Promise<void>
  removeBlockWord(id: number): Promise<void>
  listUserMutes(): UserMuteEntry[]
  addUserMute(entry: UserMuteEntry): Promise<void>
  removeUserMute(id: number): Promise<void>
}

export interface Panel {
  openUser(uid: number, uname: string): void
  openWatchlist(): void
  openBlockWords(): void
  close(): void
}

// 面板在 Shadow DOM 内，样式不会被 B 站页面污染；颜色走深色底，深浅主题下都可读。
// The panel lives in a shadow root so page styles can't leak in; dark card reads fine on both site themes.
const CSS = `
.card { position: fixed; top: 80px; right: 16px; width: 360px; max-height: 70vh; overflow-y: auto; z-index: 99999;
  background: #1f2230; color: #e8e8e8; border-radius: 8px; padding: 12px; font: 12px/1.6 sans-serif;
  box-shadow: 0 4px 24px rgba(0,0,0,.5); }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; cursor: move; user-select: none; }
.title { font-size: 14px; font-weight: 600; }
.close { cursor: pointer; color: #999; padding: 0 4px; }
.tabs { display: flex; gap: 8px; margin-bottom: 8px; }
.tab { cursor: pointer; padding: 2px 8px; border-radius: 4px; background: #2c3040; }
.tab--active { background: #1e88e5; color: #fff; }
.section { margin-top: 10px; }
.section h3 { margin: 0 0 4px; font-size: 12px; color: #9ab; }
.item { border-top: 1px solid #333; padding: 4px 0; }
.muted { color: #889; }
.badge { display: inline-block; padding: 0 4px; border-radius: 3px; color: #fff; font-size: 10px; margin-right: 4px; }
.actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
button { cursor: pointer; border: 0; border-radius: 4px; padding: 3px 8px; background: #2c3040; color: #e8e8e8; }
button.danger { background: #7a2020; }
input { flex: 1; min-width: 80px; background: #12141d; border: 1px solid #333; border-radius: 4px; color: #e8e8e8; padding: 3px 6px; }
select { background: #12141d; border: 1px solid #333; border-radius: 4px; color: #e8e8e8; padding: 3px 6px; }
a { color: #6ab0ff; text-decoration: none; }
`

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = label
  if (className) btn.className = className
  btn.addEventListener('click', onClick)
  return btn
}

/** 让卡片可经把手拖拽移动（fixed 定位，拖一次后从 right 锚点切换为 left/top）/ Make the card draggable via its handle (switches from right-anchored to left/top on first drag). */
function makeDraggable(card: HTMLElement, handle: HTMLElement): void {
  handle.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).closest('.close')) return
    event.preventDefault()
    const rect = card.getBoundingClientRect()
    card.style.right = 'auto'
    card.style.left = `${rect.left}px`
    card.style.top = `${rect.top}px`
    const dx = event.clientX - rect.left
    const dy = event.clientY - rect.top
    const move = (ev: PointerEvent) => {
      card.style.left = `${ev.clientX - dx}px`
      card.style.top = `${ev.clientY - dy}px`
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  })
}

export function createPanel(ctx: PanelContext): Panel {
  let host: HTMLElement | null = null
  let shadow: ShadowRoot | null = null
  let tab: 'user' | 'watchlist' | 'blockwords' = 'user'
  let currentUid = 0
  let currentUname = ''

  function close(): void {
    host?.remove()
    host = null
    shadow = null
  }

  function render(): void {
    if (!host) {
      host = document.createElement('div')
      host.id = 'lj-panel-host'
      document.body.appendChild(host)
      shadow = host.attachShadow({ mode: 'open' })
    }
    const root = shadow as ShadowRoot
    root.replaceChildren()
    const style = document.createElement('style')
    style.textContent = CSS
    root.appendChild(style)

    const card = el('div', 'card')
    const header = el('div', 'header')
    header.appendChild(el('span', 'title', 'Live Judgment'))
    const closeBtn = el('span', 'close', '✕')
    closeBtn.addEventListener('click', close)
    header.appendChild(closeBtn)
    card.appendChild(header)
    makeDraggable(card, header)

    const tabs = el('div', 'tabs')
    const userTab = el('span', `tab${tab === 'user' ? ' tab--active' : ''}`, '用户')
    userTab.addEventListener('click', () => {
      tab = 'user'
      render()
    })
    const watchTab = el('span', `tab${tab === 'watchlist' ? ' tab--active' : ''}`, '名单')
    watchTab.addEventListener('click', () => {
      tab = 'watchlist'
      render()
    })
    const blockTab = el('span', `tab${tab === 'blockwords' ? ' tab--active' : ''}`, '本地屏蔽')
    blockTab.addEventListener('click', () => {
      tab = 'blockwords'
      render()
    })
    tabs.append(userTab, watchTab, blockTab)
    card.appendChild(tabs)

    const body = el('div')
    card.appendChild(body)
    root.appendChild(card)

    if (tab === 'user') void renderUser(body)
    else if (tab === 'watchlist') renderWatchlist(body)
    else renderBlockWords(body)
  }

  async function renderUser(body: HTMLElement): Promise<void> {
    if (!ctx.db || !currentUid) {
      body.appendChild(el('div', 'muted', '持久化不可用或未选择用户'))
      return
    }
    body.appendChild(el('div', 'muted', '加载中…'))
    const [incidents, danmaku] = await Promise.all([
      incidentsByUid(ctx.db, currentUid),
      danmakuByUid(ctx.db, currentUid),
    ])
    const vm = buildUserViewModel(currentUid, currentUname, incidents, danmaku)
    body.replaceChildren(buildUserView(vm))
    fillAnchorNames(vm.incidents)
  }

  function buildUserView(vm: UserViewModel): HTMLElement {
    const wrap = el('div')
    wrap.appendChild(el('div', 'title', `${vm.uname}（uid: ${vm.uid}）`))

    const incidentSection = el('div', 'section')
    incidentSection.appendChild(el('h3', '', `违规档案（${vm.incidents.length}）`))
    if (vm.incidents.length === 0) {
      incidentSection.appendChild(el('div', 'muted', '暂无记录'))
    }
    for (const incident of vm.incidents) {
      const item = el('div', 'item')
      const ruleBadge = el('span', 'badge', incident.rule)
      ruleBadge.style.backgroundColor = incident.confidence === 'high' ? '#c0392b' : '#8a6d1d'
      item.appendChild(ruleBadge)
      item.appendChild(el('span', '', `${incident.ruleName} ${incident.timeText}`))
      item.appendChild(el('div', 'muted', incident.evidence.join('；')))
      const room = el('div')
      const link = document.createElement('a')
      link.href = `https://live.bilibili.com/${incident.roomId}`
      link.target = '_blank'
      link.dataset.roomId = String(incident.roomId)
      link.textContent = `房间 ${incident.roomId}`
      room.appendChild(link)
      item.appendChild(room)
      incidentSection.appendChild(item)
    }
    wrap.appendChild(incidentSection)

    const danmakuSection = el('div', 'section')
    danmakuSection.appendChild(el('h3', '', `弹幕历史（最近 ${vm.danmaku.length} 条）`))
    if (vm.danmaku.length === 0) {
      danmakuSection.appendChild(el('div', 'muted', '暂无记录'))
    }
    for (const d of vm.danmaku) {
      const item = el('div', 'item')
      item.appendChild(el('span', 'muted', `${d.timeText} `))
      item.appendChild(el('span', '', d.text))
      danmakuSection.appendChild(item)
    }
    wrap.appendChild(danmakuSection)

    wrap.appendChild(buildActions(vm.uid, vm.uname))
    return wrap
  }

  // 异步补主播名：先显示房间号，解析成功后替换 / Fill anchor names async: room id first, replaced on resolve.
  function fillAnchorNames(incidents: IncidentView[]): void {
    if (!ctx.db || !shadow) return
    const roomIds = [...new Set(incidents.map((i) => i.roomId))]
    for (const roomId of roomIds) {
      void resolveAnchorName(ctx.db, roomId).then((name) => {
        if (!name || !shadow) return
        for (const link of shadow.querySelectorAll(`[data-room-id="${roomId}"]`)) {
          link.textContent = `${name} 的直播间（${roomId}）`
        }
      })
    }
  }

  function buildActions(uid: number, uname: string): HTMLElement {
    const row = el('div', 'actions')
    if (ctx.getWatchlistEntry(uid)) {
      row.appendChild(
        button('移出人工名单', () => {
          void ctx.removeWatch(uid).then(render)
        }),
      )
    } else {
      const input = document.createElement('input')
      input.placeholder = '备注（可选）'
      row.appendChild(input)
      row.appendChild(
        button('加入人工名单', () => {
          const note = input.value.trim()
          void ctx
            .addWatch({
              uid,
              uname,
              addedAt: Date.now(),
              fromRoomId: ctx.currentRoomId,
              ...(note ? { note } : {}),
            })
            .then(render)
        }),
      )
    }
    row.appendChild(
      button(
        '清空该用户档案',
        () => {
          if (!confirm(`确认清空 ${uname}（uid: ${uid}）的全部违规档案？`)) return
          if (ctx.db) void deleteIncidentsByUid(ctx.db, uid).then(render)
        },
        'danger',
      ),
    )
    // 本地屏蔽（隐藏其弹幕）与人工名单（标记观察）是两种处置，并列给出。
    // Local mute (hide messages) and manual watchlist (mark & observe) are different dispositions; offer both.
    const activeMutes = ctx
      .listUserMutes()
      .filter((m) => m.uid === uid && (m.roomId === 0 || m.roomId === ctx.currentRoomId))
    if (activeMutes.length > 0) {
      row.appendChild(
        button('解除本地屏蔽', () => {
          void (async () => {
            for (const m of activeMutes) {
              if (m.id !== undefined) await ctx.removeUserMute(m.id)
            }
          })().then(render)
        }),
      )
    } else {
      const scope = document.createElement('select')
      const optRoom = document.createElement('option')
      optRoom.value = 'room'
      optRoom.textContent = '本房间'
      const optGlobal = document.createElement('option')
      optGlobal.value = 'global'
      optGlobal.textContent = '全局'
      scope.append(optRoom, optGlobal)
      row.appendChild(scope)
      row.appendChild(
        button('本地屏蔽此人', () => {
          void ctx
            .addUserMute({
              uid,
              uname,
              roomId: scope.value === 'global' ? 0 : ctx.currentRoomId,
              addedAt: Date.now(),
            })
            .then(render)
        }),
      )
    }
    return row
  }

  function renderWatchlist(body: HTMLElement): void {
    const list = ctx.listWatchlist()
    body.appendChild(el('h3', '', `人工名单（${list.length}）`))
    if (list.length === 0) {
      body.appendChild(el('div', 'muted', '名单为空。点击弹幕上的徽章可将用户加入名单。'))
    }
    for (const entry of list) {
      const item = el('div', 'item')
      item.appendChild(el('span', '', `${entry.uname}（uid: ${entry.uid}）`))
      const meta = [`来源房间 ${entry.fromRoomId}`]
      if (entry.note) meta.push(`备注：${entry.note}`)
      item.appendChild(el('div', 'muted', meta.join('；')))
      item.appendChild(
        button('移出', () => {
          void ctx.removeWatch(entry.uid).then(render)
        }),
      )
      body.appendChild(item)
    }
    const footer = el('div', 'actions')
    footer.appendChild(
      button(
        '清空全部违规档案',
        () => {
          if (!confirm('确认清空全部违规档案？此操作不可撤销。')) return
          if (ctx.db) void clearIncidents(ctx.db).then(render)
        },
        'danger',
      ),
    )
    body.appendChild(footer)
  }

  // 分组列出当前房间与全局词条；增删后 ctx 回调已重建 matcher，这里只需重绘列表。
  // Entries are grouped by current room and global scope; ctx callbacks already rebuilt the matcher, so only re-render here.
  function renderBlockWords(body: HTMLElement): void {
    const entries = ctx.listBlockWords()
    const groups: Array<{ title: string; items: BlockWordEntry[] }> = [
      {
        title: `本房间（${ctx.currentRoomId}）`,
        items: entries.filter((e) => e.roomId === ctx.currentRoomId),
      },
      { title: '全局', items: entries.filter((e) => e.roomId === 0) },
    ]
    for (const group of groups) {
      const section = el('div', 'section')
      section.appendChild(el('h3', '', `${group.title}（${group.items.length}）`))
      if (group.items.length === 0) section.appendChild(el('div', 'muted', '暂无词条'))
      for (const item of group.items) {
        const row = el('div', 'item')
        if (item.isRegex) {
          const tag = el('span', 'badge', 'regex')
          tag.style.backgroundColor = '#8a6d1d'
          row.appendChild(tag)
        }
        row.appendChild(el('span', '', item.word))
        row.appendChild(
          button('删除', () => {
            if (item.id !== undefined) void ctx.removeBlockWord(item.id).then(render)
          }),
        )
        section.appendChild(row)
      }
      body.appendChild(section)
    }

    // 本地屏蔽的用户分组（本房间/全局），解除走同一 reapply 链路 / Locally muted-user groups (room/global); unmute reuses the same reapply path.
    const mutes = ctx.listUserMutes()
    const muteGroups: Array<{ title: string; items: UserMuteEntry[] }> = [
      {
        title: `本地屏蔽 · 本房间（${ctx.currentRoomId}）`,
        items: mutes.filter((m) => m.roomId === ctx.currentRoomId),
      },
      { title: '本地屏蔽 · 全局', items: mutes.filter((m) => m.roomId === 0) },
    ]
    for (const group of muteGroups) {
      const section = el('div', 'section')
      section.appendChild(el('h3', '', `${group.title}（${group.items.length}）`))
      if (group.items.length === 0) section.appendChild(el('div', 'muted', '暂无本地屏蔽用户'))
      for (const item of group.items) {
        const row = el('div', 'item')
        row.appendChild(el('span', '', `${item.uname}（uid: ${item.uid}）`))
        row.appendChild(
          button('解除', () => {
            if (item.id !== undefined) void ctx.removeUserMute(item.id).then(render)
          }),
        )
        section.appendChild(row)
      }
      body.appendChild(section)
    }

    const form = el('div', 'actions')
    const input = document.createElement('input')
    input.placeholder = '屏蔽词或正则'
    const regexLabel = el('label')
    const regexBox = document.createElement('input')
    regexBox.type = 'checkbox'
    regexLabel.append(regexBox, '正则')
    const scope = document.createElement('select')
    const optRoom = document.createElement('option')
    optRoom.value = 'room'
    optRoom.textContent = '本房间'
    const optGlobal = document.createElement('option')
    optGlobal.value = 'global'
    optGlobal.textContent = '全局'
    scope.append(optRoom, optGlobal)
    form.append(
      input,
      regexLabel,
      scope,
      button('添加', () => {
        const word = input.value.trim()
        if (!word) return
        void ctx
          .addBlockWord({
            word,
            isRegex: regexBox.checked,
            roomId: scope.value === 'global' ? 0 : ctx.currentRoomId,
          })
          .then(render)
      }),
    )
    body.appendChild(form)
  }

  return {
    openUser(uid, uname) {
      currentUid = uid
      currentUname = uname
      tab = 'user'
      render()
    },
    openWatchlist() {
      tab = 'watchlist'
      render()
    },
    openBlockWords() {
      tab = 'blockwords'
      render()
    },
    close,
  }
}
