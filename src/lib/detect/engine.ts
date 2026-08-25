import type { DanmakuEvent, NormalizedEvent } from '../types'
import { normalizeText } from './normalize'
import { checkRepeatLoop } from './rules/d1-repeat'
import { checkInvisibleChars } from './rules/d2-invisible'
import { BandwagonTracker } from './rules/d4-bandwagon'
import { checkLongOfftopic, computeGlobalStats } from './rules/d8-long-offtopic'
import {
  type DetectConfig,
  defaultDetectConfig,
  type RuleHit,
  type RuleId,
  type UserVerdict,
} from './verdict'
import { SlidingWindow } from './window'

export type { UserVerdict } from './verdict'

export type VerdictListener = (verdict: UserVerdict) => void

/**
 * 检测引擎：消费弹幕事件流，产出并维护用户判定。
 * 判定有退出机制（spec 011）：命中超过 verdictDecayMs 未复现即衰减，
 * sweep 时以 hits 为空的 verdict 通知「该用户判定已退出」（listener 据此摘徽章）。
 * Detection engine: consumes danmaku events, maintains per-user verdicts.
 * Verdicts decay (spec 011): a hit not re-firing within verdictDecayMs exits;
 * sweep notifies with an empty-hits verdict (listeners remove badges accordingly).
 */
export interface DetectionEngine {
  ingest(event: DanmakuEvent): void
  /** 批量摄入：normalize 每事件算一次，D8 全局统计每批算一次 / Batch ingest: one normalize per event, one global-stats pass per batch. */
  ingestBatch(events: readonly DanmakuEvent[]): void
  getVerdict(uid: number): UserVerdict | undefined
  /** 衰减扫描：摘除过期命中，顺带 GC 空窗口与过期趋势 / Decay sweep: drop stale hits, GC empty windows and expired trends. */
  sweep(now: number): void
  /** 判定新增、置信度升级、衰减降级/退出时回调；退出以 hits: [] 表示 / Fires on new hits, upgrades, and decay downgrade/exit (exit = empty hits). */
  onVerdict(listener: VerdictListener): () => void
}

const CONFIDENCE_RANK: Record<string, number> = { medium: 1, high: 2 }

// 全局窗口条数上限：火爆房间 60s 可达数千条，无上限会拖垮逐批统计（spec 011）
// Global window cap: hot rooms produce thousands per minute; an unbounded window stalls batch stats.
const GLOBAL_WINDOW_MAX = 1000

/**
 * config 可传取值函数实现热更新（规则每次调用取最新值，设置变更不重建引擎、保住窗口状态）；
 * isRuleEnabled 控制规则开关，被关规则整条跳过判定。
 * config may be a getter for hot updates (rules read the latest value per call; changing settings
 * never rebuilds the engine, preserving window state); isRuleEnabled gates rules off entirely.
 */
export function createDetectionEngine(
  config: DetectConfig | (() => DetectConfig) = defaultDetectConfig,
  isRuleEnabled: (rule: RuleId) => boolean = () => true,
): DetectionEngine {
  const cfg = typeof config === 'function' ? config : () => config
  const userWindows = new Map<number, SlidingWindow<NormalizedEvent>>()
  const globalWindow = new SlidingWindow<NormalizedEvent>(cfg().globalWindowMs, GLOBAL_WINDOW_MAX)
  const bandwagon = new BandwagonTracker(() => cfg().d4)
  const verdicts = new Map<number, UserVerdict>()
  // 每个用户每条规则的最后命中时刻，衰减判定依据 / Last-hit time per user per rule, the basis for decay.
  const lastSeen = new Map<number, Map<RuleId, number>>()
  const listeners = new Set<VerdictListener>()

  function userWindowOf(uid: number): SlidingWindow<NormalizedEvent> {
    let w = userWindows.get(uid)
    if (!w) {
      w = new SlidingWindow(cfg().userWindowMs, cfg().userWindowMax)
      userWindows.set(uid, w)
    }
    return w
  }

  function emit(verdict: UserVerdict): void {
    for (const listener of listeners) listener(verdict)
  }

  function ingestBatch(events: readonly DanmakuEvent[]): void {
    if (events.length === 0) return
    // 归一化在此处只做一次，窗口与全部规则共享缓存（spec 011 性能核心）
    // Normalize exactly once here; windows and all rules share the cached result.
    const enriched: NormalizedEvent[] = events.map((e) => ({ ...e, norm: normalizeText(e.text) }))
    const hitsByUid = new Map<number, RuleHit[]>()
    const lastEventByUid = new Map<number, NormalizedEvent>()
    const collect = (uid: number, hit: RuleHit | null): void => {
      if (!hit) return
      const list = hitsByUid.get(uid)
      if (list) list.push(hit)
      else hitsByUid.set(uid, [hit])
    }

    // 逐事件：入窗 + D2（单条即判）/ Per event: window push + D2 (single-message verdict).
    for (const e of enriched) {
      lastEventByUid.set(e.uid, e)
      userWindowOf(e.uid).push(e)
      globalWindow.push(e)
      if (isRuleEnabled('D2')) collect(e.uid, checkInvisibleChars(e.text))
    }

    // D4 逐事件保序（趋势达成与跟风统计有先后顺序）/ D4 per event in order (trend qualification and join stats are order-sensitive).
    if (isRuleEnabled('D4')) {
      for (const e of enriched) collect(e.uid, bandwagon.onEvent(e, globalWindow.values()))
    }

    // D1/D0 与 D8 按触及用户各评估一次；D8 全局统计每批只算一次
    // D1/D0 and D8 evaluated once per touched user; D8 global stats computed once per batch.
    const d1LikeOn = isRuleEnabled('D1') || isRuleEnabled('D0')
    const d8On = isRuleEnabled('D8')
    const stats = d8On ? computeGlobalStats(globalWindow.values()) : null
    for (const uid of lastEventByUid.keys()) {
      const uw = userWindowOf(uid)
      if (d1LikeOn) {
        const hit = checkRepeatLoop(uw.values(), cfg().d1)
        // D0/D1 互斥产出，按各自开关过滤 / D0 and D1 are mutually exclusive; gate by the produced rule's own switch.
        if (hit && isRuleEnabled(hit.rule)) collect(uid, hit)
      }
      if (d8On && stats) {
        collect(uid, checkLongOfftopic(uw.values(), globalWindow.values(), cfg().d8, stats))
      }
    }

    for (const [uid, hits] of hitsByUid) {
      mergeVerdict(lastEventByUid.get(uid) as NormalizedEvent, hits)
    }
  }

  function noteHits(uid: number, hits: readonly RuleHit[], ts: number): void {
    let seen = lastSeen.get(uid)
    if (!seen) {
      seen = new Map()
      lastSeen.set(uid, seen)
    }
    for (const hit of hits) seen.set(hit.rule, ts)
  }

  function mergeVerdict(event: NormalizedEvent, hits: RuleHit[]): void {
    const existing = verdicts.get(event.uid)
    const byRule = new Map(existing?.hits.map((h) => [h.rule, h]) ?? [])
    let shouldEmit = false

    // D0/D1 同源互斥：D1（自动化）成立时 D0（手动嫌疑）让位；D1 在案时忽略后续 D0（spec 011）
    // D0/D1 same signal family: D1 (automation) supersedes D0 (manual suspicion); ignore D0 while D1 stands.
    let effective = hits
    if (hits.some((h) => h.rule === 'D1') && byRule.has('D0')) {
      byRule.delete('D0')
      shouldEmit = true
    }
    if (byRule.has('D1')) effective = hits.filter((h) => h.rule !== 'D0')
    if (effective.length === 0) return

    noteHits(event.uid, effective, event.ts)

    for (const hit of effective) {
      const prev = byRule.get(hit.rule)
      if (!prev || CONFIDENCE_RANK[hit.confidence] > CONFIDENCE_RANK[prev.confidence]) {
        byRule.set(hit.rule, hit)
        shouldEmit = true
      } else {
        // 同级命中只刷新证据，不重复通知 / Same-level hit: refresh evidence without notifying.
        byRule.set(hit.rule, { ...prev, evidence: hit.evidence })
      }
    }
    if (!shouldEmit && existing) {
      // 同级命中只刷新证据，不重复通知，但存档要更新 / Same-level hit: update stored evidence without notifying.
      verdicts.set(event.uid, {
        uid: event.uid,
        uname: event.uname,
        hits: [...byRule.values()],
        updatedAt: event.ts,
      })
      return
    }

    const verdict: UserVerdict = {
      uid: event.uid,
      uname: event.uname,
      hits: [...byRule.values()],
      updatedAt: event.ts,
    }
    verdicts.set(event.uid, verdict)
    emit(verdict)
  }

  function sweep(now: number): void {
    const decay = cfg().verdictDecayMs
    // 衰减：过期命中摘除；全空 = 判定退出（空 hits 通知），部分 = 降级重绘
    // Decay: drop stale hits; empty = verdict exit (empty-hits notification), partial = downgrade redraw.
    for (const [uid, verdict] of verdicts) {
      const seen = lastSeen.get(uid)
      const kept = verdict.hits.filter((h) => {
        const t = seen?.get(h.rule)
        return t !== undefined && now - t <= decay
      })
      if (kept.length === verdict.hits.length) continue
      if (kept.length === 0) {
        verdicts.delete(uid)
        lastSeen.delete(uid)
        emit({ uid, uname: verdict.uname, hits: [], updatedAt: now })
      } else {
        const downgraded: UserVerdict = { ...verdict, hits: kept, updatedAt: now }
        verdicts.set(uid, downgraded)
        emit(downgraded)
      }
    }
    // GC：空用户窗口、过期全局事件、过期趋势 / GC: empty user windows, stale global events, expired trends.
    for (const [uid, w] of userWindows) {
      w.prune(now)
      if (w.size === 0) userWindows.delete(uid)
    }
    globalWindow.prune(now)
    bandwagon.prune(now)
  }

  return {
    ingest(event) {
      ingestBatch([event])
    },
    ingestBatch,
    getVerdict: (uid) => verdicts.get(uid),
    sweep,
    onVerdict(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
