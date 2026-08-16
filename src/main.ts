import { createDetectionEngine } from './lib/detect/engine'
import { createDomChatSource } from './lib/dom-chat-source'
import { markElement, markExisting, markManual, markManualExisting } from './lib/mark/marker'
import { parseRoomId } from './lib/room'
import { resolveAnchorName } from './lib/store/anchor'
import { DanmakuBuffer } from './lib/store/danmaku'
import { openDatabase, pruneExpiredDanmaku } from './lib/store/db'
import { addIncident } from './lib/store/incidents'
import { listWatchlist, type WatchlistEntry } from './lib/store/watchlist'

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
