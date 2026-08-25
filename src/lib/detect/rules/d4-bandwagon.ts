import type { NormalizedEvent } from '../../types'
import type { D4Config, RuleHit } from '../verdict'

interface Trend {
  qualifiedAt: number
  /** 趋势达成前的发送者（早期参与者）/ Senders up to qualification (early participants). */
  earlyUids: Set<number>
}

interface UserStats {
  joinLatencies: number[]
  earlyCount: number
}

/**
 * D4 自动融入：先判定「趋势资格」（短时间多人重复同文本），再统计谁反复在趋势形成后秒级跟发且从不做早期参与者。
 * D4 bandwagon: qualify trends (many users repeating one text quickly), then track users who
 * repeatedly join within seconds of qualification while never being early participants.
 */
export class BandwagonTracker {
  private trends = new Map<string, Trend>()
  private stats = new Map<number, UserStats>()

  // 配置走取值函数：设置页改阈值后无需重建追踪器 / Config via getter: settings-page changes apply without rebuilding the tracker.
  constructor(private readonly getCfg: () => D4Config) {}

  onEvent(event: NormalizedEvent, globalEvents: readonly NormalizedEvent[]): RuleHit | null {
    const norm = event.norm
    if (!norm) return null

    const existing = this.trends.get(norm)
    if (existing && event.ts - existing.qualifiedAt > this.getCfg().joinWindowMs) {
      // 趋势过期，允许之后重新达成 / Expired; allow re-qualification later.
      this.trends.delete(norm)
    }

    const trend = this.trends.get(norm)
    if (trend) {
      if (!trend.earlyUids.has(event.uid)) {
        this.userStats(event.uid).joinLatencies.push(event.ts - trend.qualifiedAt)
      }
    } else {
      this.maybeQualify(norm, event, globalEvents)
    }
    return this.evaluate(event.uid)
  }

  private maybeQualify(
    norm: string,
    event: NormalizedEvent,
    globalEvents: readonly NormalizedEvent[],
  ): void {
    const cutoff = event.ts - this.getCfg().trendWindowMs
    // norm 走事件缓存，火爆房间不再对全局窗口逐条重新归一化（spec 011）/ Cached norms: no re-normalizing the whole global window per message.
    const recent = globalEvents.filter((e) => e.ts >= cutoff && e.norm === norm)
    const uids = new Set(recent.map((e) => e.uid))
    if (uids.size < this.getCfg().trendMinUids || recent.length < this.getCfg().trendMinCount)
      return
    this.trends.set(norm, { qualifiedAt: event.ts, earlyUids: uids })
    for (const uid of uids) this.userStats(uid).earlyCount++
  }

  /** 删除过期趋势（sweep/GC 用）：过期趋势本就不会再接跟风，留着只占内存 / Drop expired trends (sweep/GC): they can't accept joins anymore. */
  prune(now: number): void {
    for (const [norm, trend] of this.trends) {
      if (now - trend.qualifiedAt > this.getCfg().joinWindowMs) this.trends.delete(norm)
    }
  }

  private evaluate(uid: number): RuleHit | null {
    const s = this.stats.get(uid)
    if (!s || s.joinLatencies.length < this.getCfg().joinsForMedium || s.earlyCount > 0) return null
    const avg = s.joinLatencies.reduce((a, b) => a + b, 0) / s.joinLatencies.length
    if (avg > this.getCfg().maxAvgLatencyMs) return null
    const joins = s.joinLatencies.length
    return {
      rule: 'D4',
      confidence: joins >= this.getCfg().joinsForHigh ? 'high' : 'medium',
      evidence: [`跟风 ${joins} 次，早期参与 0 次，平均延迟 ${(avg / 1000).toFixed(1)}s`],
    }
  }

  private userStats(uid: number): UserStats {
    let s = this.stats.get(uid)
    if (!s) {
      s = { joinLatencies: [], earlyCount: 0 }
      this.stats.set(uid, s)
    }
    return s
  }
}
