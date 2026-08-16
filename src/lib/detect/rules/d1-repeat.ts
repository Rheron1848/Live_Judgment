import type { DanmakuEvent } from '../../types'
import { normalizeText } from '../normalize'
import type { D1Config, RuleHit } from '../verdict'

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
  const texts = events.map((e) => normalizeText(e.text))

  // 复读：最新一条的归一化文本在窗口内反复出现 / Repeat: the latest normalized text recurs in the window.
  const latest = texts[texts.length - 1]
  const repeatCount = texts.filter((t) => t === latest).length
  if (latest && repeatCount >= cfg.repeatMin) {
    evidence.push(`复读：「${latest.slice(0, 20)}」窗口内出现 ${repeatCount} 次`)
  }

  // 固定节拍：间隔贴着平台限速地板且几乎不波动（人类发言的间隔分布很散）
  // Cadence: intervals hug the platform rate-limit floor with near-zero variance (human pacing is scattered).
  if (events.length > cfg.intervalSamples) {
    const intervals: number[] = []
    for (let i = events.length - cfg.intervalSamples; i < events.length; i++) {
      intervals.push(events[i].ts - events[i - 1].ts)
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
