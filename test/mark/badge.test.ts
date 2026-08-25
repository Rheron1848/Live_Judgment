import { describe, expect, test } from 'bun:test'
import type { UserVerdict } from '../../src/lib/detect/verdict'
import { badgesForVerdict } from '../../src/lib/mark/badge'

const verdict: UserVerdict = {
  uid: 42,
  uname: 'tester',
  updatedAt: 0,
  hits: [
    { rule: 'D1', confidence: 'high', evidence: ['复读：「x」窗口内出现 5 次', '节拍：稳定'] },
    { rule: 'D4', confidence: 'medium', evidence: ['跟风 3 次'] },
  ],
}

describe('badgesForVerdict', () => {
  test('每条命中规则生成一枚徽章', () => {
    const badges = badgesForVerdict(verdict)
    expect(badges).toHaveLength(2)
    expect(badges.map((b) => b.rule)).toEqual(['D1', 'D4'])
  })

  test('高置信实心、中置信非实心，配色按规则区分', () => {
    const [d1, d4] = badgesForVerdict(verdict)
    expect(d1.solid).toBe(true)
    expect(d4.solid).toBe(false)
    expect(d1.color).not.toBe(d4.color)
  })

  test('title 含规则名、置信度与证据逐行', () => {
    const [d1] = badgesForVerdict(verdict)
    expect(d1.title).toContain('独轮车复读')
    expect(d1.title).toContain('高置信')
    expect(d1.title).toContain('复读：「x」窗口内出现 5 次')
    expect(d1.title.split('\n')).toHaveLength(3)
  })

  test('D0 手动复读嫌疑：淡色非实心徽章', () => {
    const [d0] = badgesForVerdict({
      uid: 7,
      uname: 'manual',
      updatedAt: 0,
      hits: [{ rule: 'D0', confidence: 'medium', evidence: ['复读：「前排」窗口内出现 3 次'] }],
    })
    expect(d0.label).toBe('D0')
    expect(d0.solid).toBe(false)
    expect(d0.title).toContain('手动复读')
  })
})
