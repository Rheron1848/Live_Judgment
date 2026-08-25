import { normalizeText } from '../detect/normalize'
import { type DetectConfig, defaultDetectConfig, type RuleId } from '../detect/verdict'

/** F6 命中处理模式 / How block-word hits are presented. */
export type F6Mode = 'hide' | 'highlight'

/**
 * 用户覆盖项（稀疏对象，只存改过的字段；存进 IDB 的就是它）。
 * User overrides (sparse; only changed fields are stored — this is what lands in IDB).
 */
export interface SettingsOverride {
  rules?: Partial<Record<RuleId, boolean>>
  userWindowMs?: number
  d1?: { repeatMin?: number; exemptTexts?: string[] }
  d4?: { joinsForMedium?: number }
  d8?: { minLen?: number; consecutiveMin?: number }
  f6Mode?: F6Mode
  markHighlight?: boolean
  retentionDays?: number
}

/** 生效配置 = 默认值 + 合法覆盖 / Effective settings = defaults + valid overrides. */
export interface EffectiveSettings {
  detect: DetectConfig
  rules: Record<RuleId, boolean>
  f6Mode: F6Mode
  markHighlight: boolean
  retentionDays: number
}

export const defaultSettings: EffectiveSettings = {
  detect: defaultDetectConfig,
  rules: { D0: true, D1: true, D2: true, D4: true, D8: true },
  f6Mode: 'hide',
  markHighlight: false,
  retentionDays: 7,
}

// 只开放调不错方向的参数并做硬范围校验；其余细参数保持代码内（spec 010「明确不开放」）。
// Only expose parameters with hard range validation; finer knobs stay in code (spec 010).
function numIn(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined
  return v >= min && v <= max ? v : undefined
}

function warnIgnored(field: string, value: unknown): void {
  console.warn(`[LiveJudgment] invalid setting ignored: ${field} =`, value)
}

const RULE_IDS: readonly RuleId[] = ['D0', 'D1', 'D2', 'D4', 'D8']

function sanitizeRules(
  rules: SettingsOverride['rules'],
): Partial<Record<RuleId, boolean>> | undefined {
  if (!rules || typeof rules !== 'object') return undefined
  const out: Partial<Record<RuleId, boolean>> = {}
  for (const id of RULE_IDS) {
    const v = rules[id]
    if (typeof v === 'boolean') out[id] = v
    else if (v !== undefined) warnIgnored(`rules.${id}`, v)
  }
  return out
}

/** 豁免名单：归一化后存储（D1 对归一化文本判定），过滤空串，去重，限量防爆。
 *  Exempt texts: stored normalized (D1 matches normalized text), blanks dropped, deduped, capped. */
function sanitizeExemptTexts(texts: unknown): string[] | undefined {
  if (texts === undefined) return undefined
  if (!Array.isArray(texts)) {
    warnIgnored('d1.exemptTexts', texts)
    return undefined
  }
  const out: string[] = []
  for (const t of texts) {
    if (typeof t !== 'string') continue
    const n = normalizeText(t)
    if (n && !out.includes(n)) out.push(n)
    if (out.length >= 50) break
  }
  return out
}

/**
 * 合并用户覆盖到默认值：非法字段逐字段拒绝并回退默认（不拖垮整份配置），不污染 defaultDetectConfig。
 * Merge user overrides onto defaults: invalid fields are rejected individually (falling back to the
 * default) without sinking the whole config; defaultDetectConfig is never mutated.
 */
export function mergeConfig(override: SettingsOverride): EffectiveSettings {
  const d = defaultDetectConfig

  const userWindowMs = numIn(override.userWindowMs, 10_000, 600_000)
  if (override.userWindowMs !== undefined && userWindowMs === undefined) {
    warnIgnored('userWindowMs', override.userWindowMs)
  }
  const repeatMin = numIn(override.d1?.repeatMin, 2, 10)
  if (override.d1?.repeatMin !== undefined && repeatMin === undefined) {
    warnIgnored('d1.repeatMin', override.d1.repeatMin)
  }
  // joinsForMedium 上限贴住 joinsForHigh，越过会让「中等」永不触发 / Cap joinsForMedium at joinsForHigh, otherwise "medium" can never trigger.
  const joinsForMedium = numIn(override.d4?.joinsForMedium, 2, d.d4.joinsForHigh)
  if (override.d4?.joinsForMedium !== undefined && joinsForMedium === undefined) {
    warnIgnored('d4.joinsForMedium', override.d4.joinsForMedium)
  }
  const minLen = numIn(override.d8?.minLen, 10, 200)
  if (override.d8?.minLen !== undefined && minLen === undefined) {
    warnIgnored('d8.minLen', override.d8.minLen)
  }
  const consecutiveMin = numIn(override.d8?.consecutiveMin, 2, 10)
  if (override.d8?.consecutiveMin !== undefined && consecutiveMin === undefined) {
    warnIgnored('d8.consecutiveMin', override.d8.consecutiveMin)
  }
  const retentionDays = numIn(override.retentionDays, 1, 30)
  if (override.retentionDays !== undefined && retentionDays === undefined) {
    warnIgnored('retentionDays', override.retentionDays)
  }
  const f6Mode =
    override.f6Mode === undefined || override.f6Mode === 'hide' || override.f6Mode === 'highlight'
      ? override.f6Mode
      : undefined
  if (override.f6Mode !== undefined && f6Mode === undefined) warnIgnored('f6Mode', override.f6Mode)
  if (override.markHighlight !== undefined && typeof override.markHighlight !== 'boolean') {
    warnIgnored('markHighlight', override.markHighlight)
  }

  return {
    detect: {
      ...d,
      userWindowMs: userWindowMs ?? d.userWindowMs,
      d1: {
        ...d.d1,
        repeatMin: repeatMin ?? d.d1.repeatMin,
        exemptTexts: sanitizeExemptTexts(override.d1?.exemptTexts) ?? d.d1.exemptTexts,
      },
      d4: { ...d.d4, joinsForMedium: joinsForMedium ?? d.d4.joinsForMedium },
      d8: {
        ...d.d8,
        minLen: minLen ?? d.d8.minLen,
        consecutiveMin: consecutiveMin ?? d.d8.consecutiveMin,
      },
    },
    rules: { ...defaultSettings.rules, ...sanitizeRules(override.rules) },
    f6Mode: f6Mode ?? 'hide',
    markHighlight: override.markHighlight === true,
    retentionDays: retentionDays ?? defaultSettings.retentionDays,
  }
}
