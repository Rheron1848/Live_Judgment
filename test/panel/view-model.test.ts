import { describe, expect, test } from 'bun:test'
import { buildUserViewModel, formatTime } from '../../src/lib/panel/view-model'
import type { DanmakuRecord } from '../../src/lib/store/danmaku'
import type { IncidentRecord } from '../../src/lib/store/incidents'

const T1 = 1_800_000_000_000
const T2 = T1 + 60_000

const incidents: IncidentRecord[] = [
  {
    uid: 9,
    uname: 'bot',
    rule: 'D4',
    confidence: 'medium',
    evidence: ['跟风 3 次'],
    roomId: 200,
    ts: T2,
  },
  { uid: 9, uname: 'bot', rule: 'D1', confidence: 'high', evidence: ['复读'], roomId: 100, ts: T1 },
]

const danmaku: DanmakuRecord[] = [
  { uid: 9, uname: 'bot', text: '第二条', roomId: 200, ts: T2 },
  { uid: 9, uname: 'bot', text: '第一条', roomId: 100, ts: T1 },
]

describe('buildUserViewModel', () => {
  test('违规档案按时间倒序并映射规则名', () => {
    const vm = buildUserViewModel(9, 'bot', incidents, [])
    expect(vm.incidents.map((i) => i.rule)).toEqual(['D4', 'D1'])
    expect(vm.incidents[0].ruleName).toBe('自动融入跟风')
    expect(vm.incidents[1].ruleName).toBe('独轮车复读')
    expect(vm.incidents[1].roomId).toBe(100)
  })

  test('弹幕历史保留顺序并格式化时间', () => {
    const vm = buildUserViewModel(9, 'bot', [], danmaku)
    expect(vm.danmaku.map((d) => d.text)).toEqual(['第二条', '第一条'])
    expect(vm.danmaku[0].timeText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  test('空档案/空弹幕安全', () => {
    const vm = buildUserViewModel(9, 'bot', [], [])
    expect(vm.incidents).toHaveLength(0)
    expect(vm.danmaku).toHaveLength(0)
  })
})

describe('formatTime', () => {
  test('输出固定格式 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatTime(T1)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})
