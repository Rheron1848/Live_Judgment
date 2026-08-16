import { findInvisibleChars } from '../normalize'
import type { RuleHit } from '../verdict'

/** D2：文本含不可见字符；正常输入法不产出，单条命中即高置信 / D2: invisible chars in text; a single hit is high-confidence. */
export function checkInvisibleChars(text: string): RuleHit | null {
  const chars = findInvisibleChars(text)
  if (chars.length === 0) return null
  return { rule: 'D2', confidence: 'high', evidence: [`含不可见字符：${chars.join('、')}`] }
}
