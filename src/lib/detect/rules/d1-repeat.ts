import type { DanmakuEvent } from '../../types'
import { normalizeText } from '../normalize'
import type { D1Config, RuleHit } from '../verdict'

/** 是否 D1 豁免文本（对归一化后文本判定；名单在 defaultDetectConfig.d1）/ Whether a normalized text is exempt from D1 (list lives in defaultDetectConfig.d1). */
export function isD1ExemptText(normalized: string, cfg: D1Config): boolean {
  if (!normalized) return false
  return (
    cfg.exemptTexts.includes(normalized) || cfg.exemptPatterns.some((re) => re.test(normalized))
  )
}

function coefficientOfVariation(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return Number.POSITIVE_INFINITY
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

/** 检测序列尾部是否为 len 长循环重复 cycleMinRounds 轮 / Whether the sequence tail is `cycleMinRounds` repetitions of a `len`-cycle. */
function findCycleLen(texts: readonly string[], cfg: D1Config): number | null {
  for (let len = cfg.cycleMinLen; len <= cfg.cycleMaxLen; len++) {
    const need = len * cfg.cycleMinRounds
    if (texts.length < need) continue
    const tail = texts.slice(-need)
    // 全部相同的序列是复读而非轮播，避免重复计信号 / An all-identical tail is repeat, not carousel; don't double-count.
    if (new Set(tail.slice(0, len)).size < 2) continue
    let ok = true
    for (let i = len; i < tail.length && ok; i++) {
      if (tail[i] !== tail[i % len]) ok = false
    }
    if (ok) return len
  }
  return null
}

/** D1 独轮车：复读 / 固定节拍 / 轮播三信号累计，≥2 项升高置信 / D1 repeat-loop: repeat + cadence + carousel; ≥2 signals upgrade to high. */
export function checkRepeatLoop(events: readonly DanmakuEvent[], cfg: D1Config): RuleHit | null {
  const evidence: string[] = []
  // 豁免文本整条剔除后再算信号：它们既不构成复读/轮播，也不参与节拍间隔。
  // Exempt texts are removed wholesale before signal computation: they count toward
  // neither repeat/carousel nor the cadence intervals.
  const kept = events.filter((e) => !isD1ExemptText(normalizeText(e.text), cfg))
  const texts = kept.map((e) => normalizeText(e.text))

  // 复读：最新一条的归一化文本在窗口内反复出现 / Repeat: the latest normalized text recurs in the window.
  const latest = texts[texts.length - 1]
  const repeatCount = texts.filter((t) => t === latest).length
  if (latest && repeatCount >= cfg.repeatMin) {
    evidence.push(`复读：「${latest.slice(0, 20)}」窗口内出现 ${repeatCount} 次`)
  }

  // 固定节拍：间隔贴着平台限速地板且几乎不波动（人类发言的间隔分布很散）
  // Cadence: intervals hug the platform rate-limit floor with near-zero variance (human pacing is scattered).
  if (kept.length > cfg.intervalSamples) {
    const intervals: number[] = []
    for (let i = kept.length - cfg.intervalSamples; i < kept.length; i++) {
      intervals.push(kept[i].ts - kept[i - 1].ts)
    }
    if (
      intervals.every((ms) => ms >= cfg.intervalMinMs) &&
      coefficientOfVariation(intervals) < cfg.maxCv
    ) {
      const mean = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      evidence.push(`节拍：最近 ${intervals.length} 个间隔稳定于 ~${mean}ms`)
    }
  }

  const cycleLen = findCycleLen(texts, cfg)
  if (cycleLen !== null) {
    evidence.push(`轮播：${cycleLen} 条循环 ×${cfg.cycleMinRounds} 轮`)
  }

  if (evidence.length === 0) return null
  return { rule: 'D1', confidence: evidence.length >= 2 ? 'high' : 'medium', evidence }
}
