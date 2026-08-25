import type { DanmakuEvent } from '../types'
import { checkRepeatLoop } from './rules/d1-repeat'
import { checkInvisibleChars } from './rules/d2-invisible'
import { BandwagonTracker } from './rules/d4-bandwagon'
import { checkLongOfftopic } from './rules/d8-long-offtopic'
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

/** 检测引擎：消费弹幕事件流，产出并维护用户判定 / Detection engine: consumes danmaku events, maintains per-user verdicts. */
export interface DetectionEngine {
  ingest(event: DanmakuEvent): void
  getVerdict(uid: number): UserVerdict | undefined
  /** 仅在判定新增或置信度升级时回调 / Listener fires only on new hits or confidence upgrades. */
  onVerdict(listener: VerdictListener): () => void
}

const CONFIDENCE_RANK: Record<string, number> = { medium: 1, high: 2 }

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
  const userWindows = new Map<number, SlidingWindow<DanmakuEvent>>()
  const globalWindow = new SlidingWindow<DanmakuEvent>(cfg().globalWindowMs)
  const bandwagon = new BandwagonTracker(() => cfg().d4)
  const verdicts = new Map<number, UserVerdict>()
  const listeners = new Set<VerdictListener>()

  function userWindowOf(uid: number): SlidingWindow<DanmakuEvent> {
    let w = userWindows.get(uid)
    if (!w) {
      w = new SlidingWindow<DanmakuEvent>(cfg().userWindowMs, cfg().userWindowMax)
      userWindows.set(uid, w)
    }
    return w
  }

  function ingest(event: DanmakuEvent): void {
    const hits: RuleHit[] = []

    if (isRuleEnabled('D2')) {
      const d2 = checkInvisibleChars(event.text)
      if (d2) hits.push(d2)
    }

    const uw = userWindowOf(event.uid)
    uw.push(event)
    globalWindow.push(event)

    if (isRuleEnabled('D1')) {
      const d1 = checkRepeatLoop(uw.values(), cfg().d1)
      if (d1) hits.push(d1)
    }

    if (isRuleEnabled('D4')) {
      const d4 = bandwagon.onEvent(event, globalWindow.values())
      if (d4) hits.push(d4)
    }

    if (isRuleEnabled('D8')) {
      const d8 = checkLongOfftopic(uw.values(), globalWindow.values(), cfg().d8)
      if (d8) hits.push(d8)
    }

    if (hits.length > 0) mergeVerdict(event, hits)
  }

  function mergeVerdict(event: DanmakuEvent, hits: RuleHit[]): void {
    const existing = verdicts.get(event.uid)
    const byRule = new Map(existing?.hits.map((h) => [h.rule, h]) ?? [])
    let shouldEmit = false

    for (const hit of hits) {
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
    for (const listener of listeners) listener(verdict)
  }

  return {
    ingest,
    getVerdict: (uid) => verdicts.get(uid),
    onVerdict(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
