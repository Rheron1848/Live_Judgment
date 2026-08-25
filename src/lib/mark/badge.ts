import type { RuleId, UserVerdict } from '../detect/verdict'

/** 一枚徽章的展示描述 / Presentation descriptor for one badge. */
export interface BadgeSpec {
  rule: RuleId
  label: string
  color: string
  /** 实心 = 高置信，半透明 = 中置信 / Solid = high confidence, soft = medium. */
  solid: boolean
  /** 原生 title 文本：规则名 + 置信度 + 证据逐行 / Native title text: rule name + confidence + evidence lines. */
  title: string
}

const RULE_META: Record<RuleId, { label: string; color: string; name: string }> = {
  // D0 淡灰：疑似手动复读，提醒性质而非违规（spec 011）/ D0 grey: suspected manual repeat, a hint rather than a violation.
  D0: { label: 'D0', color: '#777', name: '手动复读嫌疑' },
  D1: { label: 'D1', color: '#e8890c', name: '独轮车复读' },
  D2: { label: 'D2', color: '#d03030', name: '不可见字符规避' },
  D4: { label: 'D4', color: '#7c4dff', name: '自动融入跟风' },
  D8: { label: 'D8', color: '#009688', name: '长文无关刷屏' },
}

/** 判定 → 徽章描述，每条命中规则一枚 / Verdict → badge descriptors, one per rule hit. */
export function badgesForVerdict(verdict: UserVerdict): BadgeSpec[] {
  return verdict.hits.map((hit) => {
    const meta = RULE_META[hit.rule]
    const confidenceText = hit.confidence === 'high' ? '高置信' : '中置信'
    return {
      rule: hit.rule,
      label: meta.label,
      color: meta.color,
      solid: hit.confidence === 'high',
      title: `${meta.name}（${confidenceText}）\n${hit.evidence.join('\n')}`,
    }
  })
}
