import { GM_registerMenuCommand } from '$'

import { compileBlockWords } from './lib/blockword/matcher'
import { createDetectionEngine } from './lib/detect/engine'
import { createDomChatSource } from './lib/dom-chat-source'
import { hideElement, reapplyHiding } from './lib/mark/hide'
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
import {
  addBlockWord,
  type BlockWordEntry,
  listBlockWords,
  removeBlockWord,
} from './lib/store/blockwords'
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
  // db 不可用时 blockWords 退化为会话级内存表（与 watchlist 同款降级）。
  // blockWords degrades to a session-scoped in-memory table when db is unavailable (same as watchlist).
  let blockWords: BlockWordEntry[] = []

  try {
    db = await openDatabase()
    await pruneExpiredDanmaku(db)
    buffer = new DanmakuBuffer(db)
    watchlist = new Map((await listWatchlist(db)).map((e) => [e.uid, e]))
    blockWords = await listBlockWords(db)
  } catch (err) {
    console.warn('[LiveJudgment] persistence unavailable, degrading to in-memory', err)
  }

  // 内存表是唯一事实源：增删后重建 matcher 并对在屏弹幕重判，即时生效。
  // The in-memory table is the single source of truth: rebuild the matcher and re-judge on-screen items after every change.
  let blockWordMatcher = compileBlockWords(blockWords, roomId)
  const rebuildBlockWordMatcher = () => {
    blockWordMatcher = compileBlockWords(blockWords, roomId)
    reapplyHiding(blockWordMatcher)
  }
  // 内存模式下自增 id 用负数区段，避免与 IndexedDB 正数自增键混淆。
  // In-memory ids use the negative range so they never collide with IndexedDB's positive auto-increment keys.
  let memBlockWordId = 0

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
    listBlockWords: () => [...blockWords],
    async addBlockWord(entry) {
      if (db) entry.id = await addBlockWord(db, entry)
      else entry.id = --memBlockWordId
      blockWords.push(entry)
      rebuildBlockWordMatcher()
    },
    async removeBlockWord(id) {
      if (db) await removeBlockWord(db, id)
      blockWords = blockWords.filter((e) => e.id !== id)
      rebuildBlockWordMatcher()
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
    GM_registerMenuCommand('Live Judgment 屏蔽词管理', () => panel.openBlockWords())
  }

  // 开播前已在屏的名单用户弹幕补标 / Retro-mark on-screen messages from watchlisted users.
  for (const entry of watchlist.values()) markManualExisting(entry)

  // 启动时对已在屏弹幕按屏蔽词重判一次 / Re-judge on-screen messages against block words once at startup.
  reapplyHiding(blockWordMatcher)

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
    // 命中屏蔽词只做本地隐藏，引擎 ingest 与落库照常（屏蔽 ≠ 放过违规）。
    // Block-word hits only hide locally; engine ingest and persistence still ran above (hiding ≠ excusing).
    if (blockWordMatcher.test(event.text)) hideElement(event.el)
    const entry = watchlist.get(event.uid)
    if (entry) markManual(event.el, entry)
    const verdict = engine.getVerdict(event.uid)
    if (verdict) markElement(event.el, verdict)
  })
}

const roomId = parseRoomId(location.pathname)
if (roomId !== null) void main(roomId)
