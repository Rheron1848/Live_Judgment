import type { NormalizedEvent } from '../../types'
import type { D8Config, RuleHit } from '../verdict'

function bigrams(text: string): Set<string> {
  const grams = new Set<string>()
  for (let i = 0; i < text.length - 1; i++) grams.add(text.slice(i, i + 2))
  return grams
}

// 用覆盖度而非 Jaccard：上下文集合远大于消息集合，Jaccard 分母被放大后任何消息都"无关"。
// Containment, not Jaccard: the context set dwarfs the message set, so Jaccard degenerates to "always off-topic".
function containment(grams: Set<string>, context: Set<string>): number {
  if (grams.size === 0) return 1
  let hit = 0
  for (const g of grams) if (context.has(g)) hit++
  return hit / grams.size
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const g of a) if (b.has(g)) inter++
  return inter / (a.size + b.size - inter)
}

/** 批次级全局长度统计（引擎每批算一次，避免逐事件对全局窗口全量排序，spec 011）/ Batch-level global length stats (computed once per batch by the engine). */
export interface GlobalStats {
  /** 房间长度中位数（样本不足 20 时为 0，退回绝对阈值）/ Room median length (0 when samples are scarce). */
  median: number
}

/** 从全局窗口计算批次级统计 / Compute batch-level stats from the global window. */
export function computeGlobalStats(globalEvents: readonly NormalizedEvent[]): GlobalStats {
  const lengths = globalEvents.map((e) => e.norm.length).filter((n) => n > 0)
  lengths.sort((a, b) => a - b)
  return { median: lengths.length >= 20 ? lengths[Math.floor(lengths.length / 2)] : 0 }
}

/** D8 长文无关刷屏：同一用户窗口内 ≥consecutiveMin 条「显著偏长且与上下文零重合」的弹幕 / D8: ≥consecutiveMin long, context-unrelated messages from one user. */
export function checkLongOfftopic(
  userEvents: readonly NormalizedEvent[],
  globalEvents: readonly NormalizedEvent[],
  cfg: D8Config,
  stats: GlobalStats,
): RuleHit | null {
  const uid = userEvents[userEvents.length - 1]?.uid
  if (uid === undefined) return null

  const minLen = Math.max(cfg.minLen, stats.median * cfg.lengthRatio)

  // 上下文：该用户之外最近 contextSize 条 / Context: the latest contextSize messages from other users.
  const contextGrams = bigrams(
    globalEvents
      .filter((e) => e.uid !== uid)
      .slice(-cfg.contextSize)
      .map((e) => e.norm)
      .join(' '),
  )

  const longOfftopic = userEvents.filter((e) => {
    if (e.norm.length < minLen) return false
    return containment(bigrams(e.norm), contextGrams) < cfg.overlapMax
  })
  if (longOfftopic.length < cfg.consecutiveMin) return null

  // 长文彼此高度相似（又是复读）时升高置信，与 D1 互为佐证 / Upgrade when the long texts are near-identical too (corroborates D1).
  const norms = longOfftopic.map((e) => e.norm)
  const first = bigrams(norms[0])
  const allSimilar = norms.every((n) => similarity(bigrams(n), first) > 0.5)
  const avgLen = Math.round(norms.reduce((s, n) => s + n.length, 0) / norms.length)

  return {
    rule: 'D8',
    confidence: allSimilar ? 'high' : 'medium',
    evidence: [
      `长文无关 ×${longOfftopic.length}（均长 ${avgLen} 字，长度阈值 ${minLen} 字，与上下文二元组重合 <${cfg.overlapMax}）`,
    ],
  }
}
