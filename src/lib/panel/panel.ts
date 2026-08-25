import type { ActionResult } from '../action/http'
import { NO_PERMISSION_CODE } from '../action/silence'
import type { EffectiveSettings, SettingsOverride } from '../settings/config'
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
  /** 官方屏蔽本地乐观记录（仅用于提示小字，不驱动按钮状态；接口幂等，重复操作无害）。
   *  Local optimistic record of official shield (drives only a hint line, never button state; the API is idempotent). */
  getOfficialShieldInfo(uid: number): { shielded: boolean; updatedAt: number } | undefined
  setOfficialShield(uid: number, shield: boolean): Promise<ActionResult>
  /** 拉黑状态查询；undefined 表示查询失败 / Block-state query; undefined means the query failed. */
  getBlocked(uid: number): Promise<boolean | undefined>
  setBlocked(uid: number, block: boolean): Promise<ActionResult>
  silenceUser(uid: number): Promise<ActionResult>
  /** 该用户是否有在屏弹幕（举报入口只对在屏弹幕可用）/ Whether the user has an on-screen danmaku (report entry requires one). */
  hasOnScreenDanmaku(uid: number): boolean
  openOfficialReport(uid: number): Promise<ActionResult>
  /** 设置：读生效配置 / 保存稀疏覆盖（按节合并）/ 清空重置 / Settings: read effective config / save sparse overrides (merged per section) / reset. */
  getSettings(): EffectiveSettings
  saveSettings(patch: SettingsOverride): Promise<void>
  resetSettings(): Promise<void>
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
.card { position: fixed; top: 80px; right: 16px; width: 360px; max-height: 70vh; z-index: 99999;
  display: flex; flex-direction: column;
  background: #1f2230; color: #e8e8e8; border-radius: 8px; padding: 12px; font: 12px/1.6 sans-serif;
  box-shadow: 0 4px 24px rgba(0,0,0,.5); }
.header { flex: none; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; cursor: move; user-select: none; }
.title { font-size: 14px; font-weight: 600; }
.close { cursor: pointer; color: #999; padding: 0 4px; }
.tabs { flex: none; display: flex; gap: 8px; margin-bottom: 8px; }
/* 滚动只发生在内容区，头部（含关闭按钮）与标签栏常驻 / Only the body scrolls; header (with close button) and tabs stay put. */
.body { overflow-y: auto; min-height: 0; }
.tab { cursor: pointer; padding: 2px 8px; border-radius: 4px; background: #2c3040; }
.tab--active { background: #1e88e5; color: #fff; }
.section { margin-top: 10px; }
.section h3 { margin: 0 0 4px; font-size: 12px; color: #9ab; }
.item { border-top: 1px solid #333; padding: 4px 0; }
.muted { color: #889; }
.badge { display: inline-block; padding: 0 4px; border-radius: 3px; color: #fff; font-size: 10px; margin-right: 4px; }
.actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
.act { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
button { cursor: pointer; border: 0; border-radius: 4px; padding: 3px 8px; background: #2c3040; color: #e8e8e8; }
button:disabled { opacity: .45; cursor: default; }
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
  let tab: 'user' | 'watchlist' | 'blockwords' | 'settings' = 'user'
  let currentUid = 0
  let currentUname = ''
  // 处置结果的展示文案（B 站 message 原样透传）；禁言被回 100004 后整会话置灰。
  // Display text for the last action result (Bilibili's message passed through); silence greys out for the session after a 100004.
  let actionMsg = ''
  let silenceDenied = false
  // 弹幕历史分页：每页 30 条，最多展示最近 100 条（danmakuByUid 的 limit）/ Danmaku history paging: 30 per page, up to the latest 100. */
  let danmakuPage = 0

  // 动作结果展示并触发重绘（按钮文案随状态刷新）/ Show an action result and re-render (button labels follow state).
  function showActionResult(res: ActionResult): void {
    actionMsg = res.message || (res.ok ? '操作成功' : '操作失败')
    render()
  }

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
    const settingsTab = el('span', `tab${tab === 'settings' ? ' tab--active' : ''}`, '设置')
    settingsTab.addEventListener('click', () => {
      tab = 'settings'
      render()
    })
    tabs.append(userTab, watchTab, blockTab, settingsTab)
    card.appendChild(tabs)

    const body = el('div', 'body')
    card.appendChild(body)
    root.appendChild(card)

    if (tab === 'user') void renderUser(body)
    else if (tab === 'watchlist') renderWatchlist(body)
    else if (tab === 'blockwords') renderBlockWords(body)
    else renderSettings(body)
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
    const DANMAKU_PAGE_SIZE = 30
    const pageCount = Math.max(1, Math.ceil(vm.danmaku.length / DANMAKU_PAGE_SIZE))
    danmakuPage = Math.min(Math.max(danmakuPage, 0), pageCount - 1)
    const pageItems = vm.danmaku.slice(
      danmakuPage * DANMAKU_PAGE_SIZE,
      (danmakuPage + 1) * DANMAKU_PAGE_SIZE,
    )
    for (const d of pageItems) {
      const item = el('div', 'item')
      item.appendChild(el('span', 'muted', `${d.timeText} `))
      item.appendChild(el('span', '', d.text))
      danmakuSection.appendChild(item)
    }
    if (pageCount > 1) {
      const pager = el('div', 'actions')
      const prevBtn = button('上一页', () => {
        danmakuPage -= 1
        render()
      })
      prevBtn.disabled = danmakuPage === 0
      const nextBtn = button('下一页', () => {
        danmakuPage += 1
        render()
      })
      nextBtn.disabled = danmakuPage >= pageCount - 1
      pager.append(prevBtn, el('span', 'muted', `第 ${danmakuPage + 1} / ${pageCount} 页`), nextBtn)
      danmakuSection.appendChild(pager)
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
        button('移出标记名单', () => {
          void ctx.removeWatch(uid).then(render)
        }),
      )
    } else {
      const input = document.createElement('input')
      input.placeholder = '备注（可选）'
      row.appendChild(input)
      row.appendChild(
        button('加入标记名单', () => {
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
    // ---- 处置区：个人处置（本地 + 官方）与房管处置分组，每个动作先 confirm，失败原样展示 B 站 message。
    // ---- Action area: personal (local + official) vs room-admin groups; confirm first, Bilibili's message verbatim on failure.
    const personal = el('div', 'section')
    personal.appendChild(el('h3', '', '个人处置'))

    // 本地屏蔽（隐藏其弹幕）：纯本地、立即生效。
    // Local mute (hide messages): purely local, effective immediately.
    const muteRow = el('div', 'act')
    const activeMutes = ctx
      .listUserMutes()
      .filter((m) => m.uid === uid && (m.roomId === 0 || m.roomId === ctx.currentRoomId))
    if (activeMutes.length > 0) {
      muteRow.appendChild(
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
      muteRow.appendChild(scope)
      muteRow.appendChild(
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
    muteRow.appendChild(el('span', 'muted', '立即隐藏，仅自己可见'))
    personal.appendChild(muteRow)

    // 官方屏蔽：双动作幂等模式——两个按钮始终可用（重复操作无害），本地记录只作提示小字。
    // Official shield: idempotent dual-action mode — both buttons always enabled; the local record is only a hint line.
    const shieldRow = el('div', 'act')
    shieldRow.appendChild(
      button('官方屏蔽', () => {
        const ok = confirm(
          `确认官方屏蔽 ${uname}（uid: ${uid}）？\n效果：服务端生效，下次进房起；当前页面不保证立即消失；可随时解除。`,
        )
        if (!ok) return
        void ctx.setOfficialShield(uid, true).then(showActionResult)
      }),
    )
    shieldRow.appendChild(
      button('解除官方屏蔽', () => {
        if (!confirm(`确认解除对 ${uname}（uid: ${uid}）的官方屏蔽？`)) return
        void ctx.setOfficialShield(uid, false).then(showActionResult)
      }),
    )
    shieldRow.appendChild(el('span', 'muted', '服务端生效，下次进房起；本地记录可能与实际有出入'))
    personal.appendChild(shieldRow)
    const shieldInfo = ctx.getOfficialShieldInfo(uid)
    if (shieldInfo) {
      const when = new Date(shieldInfo.updatedAt).toLocaleString()
      personal.appendChild(
        el(
          'div',
          'muted',
          `本地记录：已于 ${when} ${shieldInfo.shielded ? '官方屏蔽' : '解除官方屏蔽'}`,
        ),
      )
    }

    // 拉黑状态依赖只读接口查询，异步刷新按钮文案；查询失败默认可点「拉黑」（act=5 对已拉黑者幂等无害）。
    // Block state comes from a read-only query and fills in async; on query failure the button defaults to "拉黑" (act=5 is harmless if already blocked).
    const blockRow = el('div', 'act')
    let blockedState: boolean | undefined
    const blockBtn = button('拉黑状态查询中…', () => {
      const block = blockedState !== true
      const ok = block
        ? confirm(
            `确认将 ${uname}（uid: ${uid}）加入账号黑名单？\n效果：TA 无法关注你、与你私信/评论互动；可随时在此解除。`,
          )
        : confirm(`确认将 ${uname}（uid: ${uid}）移出账号黑名单？`)
      if (!ok) return
      void ctx.setBlocked(uid, block).then(showActionResult)
    })
    blockBtn.disabled = true
    void ctx.getBlocked(uid).then((b) => {
      blockedState = b
      blockBtn.disabled = false
      blockBtn.textContent = b === true ? '解除拉黑' : '拉黑'
      if (b === undefined) blockBtn.title = '拉黑状态查询失败，默认提供拉黑'
    })
    blockRow.appendChild(blockBtn)
    blockRow.appendChild(el('span', 'muted', '账号黑名单'))
    personal.appendChild(blockRow)

    // 举报：只打开官方面板，且只对在屏弹幕可用（历史记录场景置灰）。
    // Report: only opens the official panel, and only for on-screen danmaku (greyed out for history-only users).
    const reportRow = el('div', 'act')
    const onScreen = ctx.hasOnScreenDanmaku(uid)
    const reportBtn = button('举报选中弹幕', () => {
      const ok = confirm(
        `将针对 ${uname}（uid: ${uid}）在屏的一条弹幕打开官方举报面板。\n本脚本只打开面板，理由选择与最终提交由你在官方界面完成。继续？`,
      )
      if (!ok) return
      void ctx.openOfficialReport(uid).then(showActionResult)
    })
    reportBtn.disabled = !onScreen
    reportBtn.title = onScreen
      ? '打开官方举报面板，理由与提交在官方界面完成'
      : '仅支持当前在屏的弹幕'
    reportRow.appendChild(reportBtn)
    reportRow.appendChild(
      el('span', 'muted', onScreen ? '打开官方举报面板' : '仅支持当前在屏的弹幕'),
    )
    personal.appendChild(reportRow)

    const admin = el('div', 'section')
    admin.appendChild(el('h3', '', '房管处置'))
    const arow = el('div', 'act')
    const silenceBtn = button('禁言', () => {
      const ok = confirm(
        `确认请求在该房间永久禁言 ${uname}（uid: ${uid}）？\n需要你是该房间的房管/主播；无权限会返回错误提示。`,
      )
      if (!ok) return
      void ctx.silenceUser(uid).then((res) => {
        // 无权限回 100004 后整会话置灰，避免反复打扰 / Grey out for the session once 100004 (no permission) is returned.
        if (res.code === NO_PERMISSION_CODE) silenceDenied = true
        showActionResult(res)
      })
    })
    if (silenceDenied) {
      silenceBtn.disabled = true
      silenceBtn.title = '已确认无房管权限（B 站返回「你不是房管哦」）'
    }
    arow.appendChild(silenceBtn)
    arow.appendChild(el('span', 'muted', '需房管权限'))
    admin.appendChild(arow)

    const wrap = el('div')
    wrap.appendChild(row)
    wrap.appendChild(personal)
    wrap.appendChild(admin)
    if (actionMsg) wrap.appendChild(el('div', 'muted', actionMsg))
    return wrap
  }

  function renderWatchlist(body: HTMLElement): void {
    const list = ctx.listWatchlist()
    body.appendChild(el('h3', '', `标记名单（${list.length}）`))
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

  // 设置页：每项改动即存（change 事件），非法值由 mergeConfig 拒绝并回退默认，重绘后自然显示生效值。
  // Settings tab: every change saves immediately; invalid values are rejected by mergeConfig and fall back
  // to defaults, so the re-rendered control simply shows the effective value.
  function renderSettings(body: HTMLElement): void {
    if (!ctx.db) {
      body.appendChild(el('div', 'muted', '持久化不可用，设置不可修改（检测按默认值运行）'))
      return
    }
    const s = ctx.getSettings()
    const save = (patch: SettingsOverride) => void ctx.saveSettings(patch).then(render)

    // 数字输入行：change 时提交 / Number input row: commits on change.
    const numRow = (label: string, value: number, onCommit: (v: number) => void): HTMLElement => {
      const row = el('div', 'act')
      row.appendChild(el('span', '', label))
      const input = document.createElement('input')
      input.type = 'number'
      input.value = String(value)
      input.style.flex = '0 0 70px'
      input.addEventListener('change', () => {
        const v = Number(input.value)
        if (Number.isFinite(v)) onCommit(v)
      })
      row.appendChild(input)
      return row
    }
    const checkRow = (
      label: string,
      checked: boolean,
      onCommit: (v: boolean) => void,
    ): HTMLElement => {
      const row = el('div', 'act')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = checked
      box.style.flex = '0 0 auto'
      box.addEventListener('change', () => onCommit(box.checked))
      const lab = el('label')
      lab.append(box, label)
      row.appendChild(lab)
      return row
    }

    const rulesSec = el('div', 'section')
    rulesSec.appendChild(el('h3', '', '规则开关（关闭的规则不产生判定与徽章）'))
    // 规则含义与 README 功能概览措辞保持一致 / Rule meanings kept in sync with the README feature overview.
    const ruleLabels: Record<string, string> = {
      D0: 'D0 手动复读嫌疑（淡色提醒，非自动化判定，可关闭）',
      D1: 'D1 独轮车复读（重复刷屏 / 固定节拍 / 轮播）',
      D2: 'D2 不可见字符规避',
      D4: 'D4 自动融入（只跟风不发起）',
      D8: 'D8 长文无关灌水',
    }
    for (const id of ['D0', 'D1', 'D2', 'D4', 'D8'] as const) {
      rulesSec.appendChild(checkRow(ruleLabels[id], s.rules[id], (v) => save({ rules: { [id]: v } })))
    }
    body.appendChild(rulesSec)

    const thSec = el('div', 'section')
    thSec.appendChild(el('h3', '', '关键阈值'))
    thSec.appendChild(
      numRow('D1 复读次数（≥2）', s.detect.d1.repeatMin, (v) => save({ d1: { repeatMin: v } })),
    )
    thSec.appendChild(
      numRow('D1 窗口秒数（10~600）', s.detect.userWindowMs / 1000, (v) =>
        save({ userWindowMs: v * 1000 }),
      ),
    )
    thSec.appendChild(
      numRow('D4 跟风次数（2~5）', s.detect.d4.joinsForMedium, (v) =>
        save({ d4: { joinsForMedium: v } }),
      ),
    )
    thSec.appendChild(
      numRow('D8 长文字数（10~200）', s.detect.d8.minLen, (v) => save({ d8: { minLen: v } })),
    )
    thSec.appendChild(
      numRow('D8 连续条数（≥2）', s.detect.d8.consecutiveMin, (v) =>
        save({ d8: { consecutiveMin: v } }),
      ),
    )
    body.appendChild(thSec)

    const exemptSec = el('div', 'section')
    exemptSec.appendChild(el('h3', '', `D1 豁免名单（${s.detect.d1.exemptTexts.length}）`))
    // 内置正则豁免始终生效但不进可编辑名单，展示出来避免误以为失效（verdict.ts exemptPatterns）
    // Built-in pattern exemptions are always on and not editable; shown here so users know they exist.
    exemptSec.appendChild(
      el('p', '', '内置豁免（始终生效，不可删除）：纯标点符号、[表情]、/名字/ 打call、\\名字/ 连打'),
    )
    for (const text of s.detect.d1.exemptTexts) {
      const row = el('div', 'item')
      row.appendChild(el('span', '', text))
      row.appendChild(
        button('删除', () =>
          save({ d1: { exemptTexts: s.detect.d1.exemptTexts.filter((t) => t !== text) } }),
        ),
      )
      exemptSec.appendChild(row)
    }
    const exemptForm = el('div', 'actions')
    const exemptInput = document.createElement('input')
    exemptInput.placeholder = '新增豁免文本'
    exemptForm.append(
      exemptInput,
      button('添加', () => {
        const t = exemptInput.value.trim()
        if (!t) return
        save({ d1: { exemptTexts: [...s.detect.d1.exemptTexts, t] } })
      }),
    )
    exemptSec.appendChild(exemptForm)
    body.appendChild(exemptSec)

    const miscSec = el('div', 'section')
    miscSec.appendChild(el('h3', '', '展示与数据'))
    const f6Row = el('div', 'act')
    f6Row.appendChild(el('span', '', '本地屏蔽词命中'))
    for (const [mode, label] of [
      ['hide', '隐藏'],
      ['highlight', '高亮'],
    ] as const) {
      const lab = el('label')
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'lj-f6mode'
      radio.checked = s.f6Mode === mode
      radio.style.flex = '0 0 auto'
      radio.addEventListener('change', () => {
        if (radio.checked) save({ f6Mode: mode })
      })
      lab.append(radio, label)
      f6Row.appendChild(lab)
    }
    miscSec.appendChild(f6Row)
    miscSec.appendChild(
      checkRow('高亮整条被标记弹幕（默认关，仅徽章）', s.markHighlight, (v) =>
        save({ markHighlight: v }),
      ),
    )
    miscSec.appendChild(
      numRow('弹幕保留天数（1~30）', s.retentionDays, (v) => save({ retentionDays: v })),
    )
    body.appendChild(miscSec)

    const resetRow = el('div', 'actions')
    resetRow.appendChild(
      button(
        '重置全部设置',
        () => {
          if (!confirm('确认清空全部设置覆盖项，恢复默认？')) return
          void ctx.resetSettings().then(render)
        },
        'danger',
      ),
    )
    body.appendChild(resetRow)
  }

  return {
    openUser(uid, uname) {
      currentUid = uid
      currentUname = uname
      actionMsg = ''
      danmakuPage = 0
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
