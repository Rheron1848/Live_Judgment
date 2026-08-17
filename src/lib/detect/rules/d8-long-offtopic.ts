import type { DanmakuEvent } from '../../types'
import { normalizeText } from '../normalize'
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

/** D8 长文无关刷屏：同一用户窗口内 ≥consecutiveMin 条「显著偏长且与上下文零重合」的弹幕 / D8: ≥consecutiveMin long, context-unrelated messages from one user. */
export function checkLongOfftopic(
  userEvents: readonly DanmakuEvent[],
  globalEvents: readonly DanmakuEvent[],
  cfg: D8Config,
): RuleHit | null {
  const uid = userEvents[userEvents.length - 1]?.uid
  if (uid === undefined) return null

  // 房间长度中位数（样本不足时退回绝对阈值）/ Room median message length (absolute threshold when samples are scarce).
  const lengths = globalEvents
    .map((e) => normalizeText(e.text).length)
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
  const median = lengths.length >= 20 ? lengths[Math.floor(lengths.length / 2)] : 0
  const minLen = Math.max(cfg.minLen, median * cfg.lengthRatio)

  // 上下文：该用户之外最近 contextSize 条 / Context: the latest contextSize messages from other users.
  const contextGrams = bigrams(
    globalEvents
      .filter((e) => e.uid !== uid)
      .slice(-cfg.contextSize)
      .map((e) => normalizeText(e.text))
      .join(' '),
  )

  const longOfftopic = userEvents.filter((e) => {
    const norm = normalizeText(e.text)
    if (norm.length < minLen) return false
    return containment(bigrams(norm), contextGrams) < cfg.overlapMax
  })
  if (longOfftopic.length < cfg.consecutiveMin) return null

  // 长文彼此高度相似（又是复读）时升高置信，与 D1 互为佐证 / Upgrade when the long texts are near-identical too (corroborates D1).
  const norms = longOfftopic.map((e) => normalizeText(e.text))
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
