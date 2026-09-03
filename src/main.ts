import { GM_registerMenuCommand } from '$'

import { getBlocked, setBlock } from './lib/action/block'
import { openOfficialReport as driveOfficialReport } from './lib/action/report'
import { shieldUser } from './lib/action/shield'
import { silenceUser as silenceUserApi } from './lib/action/silence'
import { compileBlockWords } from './lib/blockword/matcher'
import { createDetectionEngine } from './lib/detect/engine'
import { createDomChatSource } from './lib/dom-chat-source'
import { hideElement, highlightElement, reapplyHiding } from './lib/mark/hide'
import {
  markElement,
  markExisting,
  markManual,
  markManualExisting,
  setMarkHighlight,
  unmarkAuto,
  unmarkManual,
} from './lib/mark/marker'
import { createPanel } from './lib/panel/panel'
import { parseRoomId } from './lib/room'
import { mergeConfig, type SettingsOverride } from './lib/settings/config'
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
  listOfficialShields,
  officialShieldKey,
  setOfficialShield,
} from './lib/store/officialshields'
import {
  loadSettings,
  resetSettings as resetSettingsStore,
  saveSettings as saveSettingsStore,
} from './lib/store/settings'
import {
  addUserMute,
  listUserMutes,
  removeUserMute,
  type UserMuteEntry,
} from './lib/store/usermutes'
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
  type WatchlistEntry,
} from './lib/store/watchlist'
import type { DanmakuEvent } from './lib/types'
import { isMuted } from './lib/usermute/mute'

async function main(roomId: number): Promise<void> {
  // 设置先于引擎就位：引擎经取值函数读 settings，改设置不重建引擎（保住窗口状态）。
  // Settings come first: the engine reads them via getters so changes never rebuild it (windows survive).
  let settingsOverride: SettingsOverride = {}
  let settings = mergeConfig(settingsOverride)
  const engine = createDetectionEngine(
    () => settings.detect,
    (rule) => settings.rules[rule],
  )

  // 持久化不可用时降级为纯内存检测，不中断标记功能。
  // Degrade to in-memory detection when persistence is unavailable; marking still works.
  let db: IDBDatabase | null = null
  let buffer: DanmakuBuffer | null = null
  let watchlist = new Map<number, WatchlistEntry>()
  // db 不可用时 blockWords / userMutes 退化为会话级内存表（与 watchlist 同款降级）。
  // blockWords/userMutes degrade to session-scoped in-memory tables when db is unavailable (same as watchlist).
  let blockWords: BlockWordEntry[] = []
  let userMutes: UserMuteEntry[] = []
  // 官方屏蔽状态：官方读回接口已失效，本地乐观记录（uid:roomId → {shielded, updatedAt}），仅作面板提示。
  // Official-shield state: the official read-back API is dead, so keep a local optimistic record (panel hint only).
  const officialShields = new Map<string, { shielded: boolean; updatedAt: number }>()

  try {
    db = await openDatabase()
    settingsOverride = await loadSettings(db)
    settings = mergeConfig(settingsOverride)
    await pruneExpiredDanmaku(db, settings.retentionDays)
    buffer = new DanmakuBuffer(db)
    watchlist = new Map((await listWatchlist(db)).map((e) => [e.uid, e]))
    blockWords = await listBlockWords(db)
    userMutes = await listUserMutes(db)
    for (const e of await listOfficialShields(db)) {
      officialShields.set(e.key, { shielded: e.shielded, updatedAt: e.updatedAt })
    }
  } catch (err) {
    console.warn('[LiveJudgment] persistence unavailable, degrading to in-memory', err)
  }

  // 内存表是唯一事实源：增删后重建 matcher 并对在屏弹幕重判，即时生效。
  // The in-memory tables are the single source of truth: rebuild the matcher and re-judge on-screen items after every change.
  let blockWordMatcher = compileBlockWords(blockWords, roomId)
  const isUidMuted = (uid: number) => isMuted(uid, roomId, userMutes)
  const reapplyAll = () => reapplyHiding(blockWordMatcher, isUidMuted, settings.f6Mode)
  const rebuildBlockWordMatcher = () => {
    blockWordMatcher = compileBlockWords(blockWords, roomId)
    reapplyAll()
  }
  // 设置应用入口：标记样式 + 隐藏/高亮模式统一刷新在屏弹幕。
  // Settings application entry: mark style + hide/highlight mode refresh on-screen items together.
  const applySettings = () => {
    setMarkHighlight(settings.markHighlight)
    reapplyAll()
  }
  // 覆盖项按节合并（面板只发改动的那一节）/ Overrides merge per section (the panel sends only the section that changed).
  const mergeOverride = (patch: SettingsOverride): SettingsOverride => ({
    ...settingsOverride,
    ...patch,
    rules: patch.rules ? { ...settingsOverride.rules, ...patch.rules } : settingsOverride.rules,
    d1: patch.d1 ? { ...settingsOverride.d1, ...patch.d1 } : settingsOverride.d1,
    d4: patch.d4 ? { ...settingsOverride.d4, ...patch.d4 } : settingsOverride.d4,
    d8: patch.d8 ? { ...settingsOverride.d8, ...patch.d8 } : settingsOverride.d8,
  })
  // 内存模式下自增 id 用负数区段，避免与 IndexedDB 正数自增键混淆。
  // In-memory ids use the negative range so they never collide with IndexedDB's positive auto-increment keys.
  let memBlockWordId = 0
  let memUserMuteId = 0

  // 已落库的判定按 uid:rule:confidence 去重，同会话不重复记档。
  // Incidents are deduped by uid:rule:confidence within a session.
  const recorded = new Set<string>()

  engine.onVerdict((verdict) => {
    // 判定衰减退出：空 hits = 摘除该用户全部检测徽章（spec 011）/ Decay exit: empty hits = strip all detection badges.
    if (verdict.hits.length === 0) {
      unmarkAuto(verdict.uid)
      return
    }
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
    listUserMutes: () => [...userMutes],
    async addUserMute(entry) {
      if (db) entry.id = await addUserMute(db, entry)
      else entry.id = --memUserMuteId
      userMutes.push(entry)
      reapplyAll()
    },
    async removeUserMute(id) {
      if (db) await removeUserMute(db, id)
      userMutes = userMutes.filter((e) => e.id !== id)
      reapplyAll()
    },
    getOfficialShieldInfo: (uid) => officialShields.get(officialShieldKey(uid, roomId)),
    async setOfficialShield(uid, shield) {
      const res = await shieldUser(uid, roomId, shield)
      if (res.ok) {
        officialShields.set(officialShieldKey(uid, roomId), {
          shielded: shield,
          updatedAt: Date.now(),
        })
        if (db) await setOfficialShield(db, uid, roomId, shield)
        res.message = shield ? '官方屏蔽成功：其弹幕将在你的新会话中被服务端过滤' : '已解除官方屏蔽'
      }
      return res
    },
    getBlocked: (uid) => getBlocked(uid),
    async setBlocked(uid, block) {
      const res = await setBlock(uid, block)
      if (res.ok) res.message = block ? '已加入账号黑名单' : '已移出账号黑名单'
      return res
    },
    silenceUser: (uid) => silenceUserApi(roomId, uid),
    hasOnScreenDanmaku: (uid) =>
      !!document.querySelector(`.chat-item.danmaku-item[data-uid="${uid}"]`),
    async openOfficialReport(uid) {
      const items = document.querySelectorAll<HTMLElement>(
        `.chat-item.danmaku-item[data-uid="${uid}"]`,
      )
      const item = items[items.length - 1]
      if (!item) return { ok: false, message: '该用户当前没有在屏弹幕' }
      return driveOfficialReport(item)
    },
    getSettings: () => settings,
    async saveSettings(patch) {
      settingsOverride = mergeOverride(patch)
      if (db) await saveSettingsStore(db, settingsOverride)
      settings = mergeConfig(settingsOverride)
      applySettings()
      // 保留天数改小立即按比例清理（每次保存顺带 prune，幂等低成本）。
      // A smaller retention prunes immediately (prune runs on every save; idempotent and cheap).
      if (db) void pruneExpiredDanmaku(db, settings.retentionDays)
    },
    async resetSettings() {
      settingsOverride = {}
      if (db) await resetSettingsStore(db)
      settings = mergeConfig({})
      applySettings()
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
    GM_registerMenuCommand('Live Judgment 本地屏蔽管理', () => panel.openBlockWords())
  }

  // 开播前已在屏的名单用户弹幕补标 / Retro-mark on-screen messages from watchlisted users.
  for (const entry of watchlist.values()) markManualExisting(entry)

  // 启动时对已在屏弹幕按屏蔽词与屏蔽名单重判一次，并应用标记样式设置 / Re-judge on-screen messages and apply the mark-style setting once at startup.
  applySettings()

  const source = createDomChatSource(roomId)
  // 检测批处理队列：事件先进队，每秒 flush 一批进引擎（spec 011，用户拍板「一定时间处理一批」）
  // Detection batch queue: events queue up and flush into the engine once per second (spec 011).
  const pending: DanmakuEvent[] = []
  source.start((event) => {
    pending.push(event)
    buffer?.push({
      uid: event.uid,
      uname: event.uname,
      text: event.text,
      roomId: event.roomId,
      ts: event.ts,
    })
    if (!event.el) return
    // 命中屏蔽名单始终隐藏；命中屏蔽词按设置隐藏或高亮；检测与落库照常（屏蔽 ≠ 放过违规）。
    // User-mute hits always hide; block-word hits hide or highlight per settings; detection and persistence still run (hiding ≠ excusing).
    if (isUidMuted(event.uid)) {
      hideElement(event.el)
    } else if (blockWordMatcher.test(event.text)) {
      if (settings.f6Mode === 'hide') hideElement(event.el)
      else highlightElement(event.el)
    }
    const entry = watchlist.get(event.uid)
    if (entry) markManual(event.el, entry)
  })

  // 批处理 flush：每秒一批；徽章在判定就绪后对批次内弹幕统一补挂 / Batch flush every second; badges are applied to the batch once verdicts are ready.
  setInterval(() => {
    if (pending.length === 0) return
    const batch = pending.splice(0)
    engine.ingestBatch(batch)
    for (const e of batch) {
      if (!e.el) continue
      const verdict = engine.getVerdict(e.uid)
      if (verdict && verdict.hits.length > 0) markElement(e.el, verdict)
    }
  }, 1000)

  // 判定衰减扫描：每分钟摘除过期命中（退出机制）并 GC 空窗口 / Decay sweep every minute: expire stale hits (exit mechanism) and GC.
  setInterval(() => engine.sweep(Date.now()), 60_000)
}

const roomId = parseRoomId(location.pathname)
if (roomId !== null) void main(roomId)
