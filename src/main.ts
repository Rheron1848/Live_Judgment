import { GM_registerMenuCommand } from '$'

import { createDetectionEngine } from './lib/detect/engine'
import { createDomChatSource } from './lib/dom-chat-source'
import {
  markElement,
  markExisting,
  markManual,
  markManualExisting,
  unmarkManual,
} from './lib/mark/marker'
import { createPanel } from './lib/panel/panel'
import { parseRoomId } from './lib/room'
import { resolveAnchorName } from './lib/store/anchor'
import { DanmakuBuffer } from './lib/store/danmaku'
import { openDatabase, pruneExpiredDanmaku } from './lib/store/db'
import { addIncident } from './lib/store/incidents'
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  type WatchlistEntry,
} from './lib/store/watchlist'

async function main(roomId: number): Promise<void> {
  const engine = createDetectionEngine()

  // 持久化不可用时降级为纯内存检测，不中断标记功能。
  // Degrade to in-memory detection when persistence is unavailable; marking still works.
  let db: IDBDatabase | null = null
  let buffer: DanmakuBuffer | null = null
  let watchlist = new Map<number, WatchlistEntry>()

  try {
    db = await openDatabase()
    await pruneExpiredDanmaku(db)
    buffer = new DanmakuBuffer(db)
    watchlist = new Map((await listWatchlist(db)).map((e) => [e.uid, e]))
  } catch (err) {
    console.warn('[LiveJudgment] persistence unavailable, degrading to in-memory', err)
  }

  // 已落库的判定按 uid:rule:confidence 去重，同会话不重复记档。
  // Incidents are deduped by uid:rule:confidence within a session.
  const recorded = new Set<string>()

  engine.onVerdict((verdict) => {
    // 调试用日志，设置面板落地后改为可选 / Debug log; make optional once the settings panel lands.
    console.log('[LiveJudgment] verdict', JSON.stringify(verdict))
    markExisting(verdict.uid, verdict)
    if (!db) return
    for (const hit of verdict.hits) {
      const key = `${verdict.uid}:${hit.rule}:${hit.confidence}`
      if (recorded.has(key)) continue
      recorded.add(key)
      void addIncident(db, {
        uid: verdict.uid,
        uname: verdict.uname,
        rule: hit.rule,
        confidence: hit.confidence,
        evidence: hit.evidence,
        roomId,
        ts: verdict.updatedAt,
      })
      void resolveAnchorName(db, roomId) // 预热主播名缓存 / Warm the anchor-name cache.
    }
  })

  const panel = createPanel({
    db,
    currentRoomId: roomId,
    getWatchlistEntry: (uid) => watchlist.get(uid),
    listWatchlist: () => [...watchlist.values()],
    async addWatch(entry) {
      if (db) await addToWatchlist(db, entry)
      watchlist.set(entry.uid, entry)
      markManualExisting(entry)
    },
    async removeWatch(uid) {
      if (db) await removeFromWatchlist(db, uid)
      watchlist.delete(uid)
      unmarkManual(uid)
    },
  })

  // 徽章点击 → 打开用户面板（事件委托）/ Badge click → open the user panel (event delegation).
  document.addEventListener('click', (event) => {
    const badge = (event.target as HTMLElement).closest?.('.lj-badge') as HTMLElement | null
    const uid = Number(badge?.dataset.ljUid)
    if (!badge || !Number.isFinite(uid) || uid <= 0) return
    const item = badge.closest('.chat-item.danmaku-item')
    const uname = item?.getAttribute('data-uname') ?? `uid:${uid}`
    panel.openUser(uid, uname)
  })

  // Tampermonkey 菜单入口；无 GM 环境（如 CDP 注入调试）时跳过 / Tampermonkey menu entry; skipped without a GM environment (e.g. CDP injection).
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Live Judgment 名单管理', () => panel.openWatchlist())
  }

  // 开播前已在屏的名单用户弹幕补标 / Retro-mark on-screen messages from watchlisted users.
  for (const entry of watchlist.values()) markManualExisting(entry)

  const source = createDomChatSource(roomId)
  source.start((event) => {
    engine.ingest(event)
    buffer?.push({
      uid: event.uid,
      uname: event.uname,
      text: event.text,
      roomId: event.roomId,
      ts: event.ts,
    })
    if (!event.el) return
    const entry = watchlist.get(event.uid)
    if (entry) markManual(event.el, entry)
    const verdict = engine.getVerdict(event.uid)
    if (verdict) markElement(event.el, verdict)
  })
}

const roomId = parseRoomId(location.pathname)
if (roomId !== null) void main(roomId)
