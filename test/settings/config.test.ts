import { describe, expect, test } from 'bun:test'
import 'fake-indexeddb/auto'
import { createDetectionEngine } from '../../src/lib/detect/engine'
import { defaultDetectConfig } from '../../src/lib/detect/verdict'
import { defaultSettings, mergeConfig } from '../../src/lib/settings/config'
import { openDatabase } from '../../src/lib/store/db'
import { loadSettings, resetSettings, saveSettings } from '../../src/lib/store/settings'
import type { DanmakuEvent } from '../../src/lib/types'

const T0 = 1_800_000_000_000

function ev(uid: number, text: string, ts: number): DanmakuEvent {
  return { uid, uname: `u${uid}`, text, ts, roomId: 1 }
}

describe('mergeConfig 默认兜底', () => {
  test('空覆盖 = 全默认', () => {
    const s = mergeConfig({})
    expect(s.detect).toEqual(defaultDetectConfig)
    expect(s.rules).toEqual({ D0: true, D1: true, D2: true, D4: true, D8: true })
    expect(s.f6Mode).toBe('hide')
    expect(s.markHighlight).toBe(false)
    expect(s.retentionDays).toBe(7)
  })
})

describe('mergeConfig 覆盖生效', () => {
  test('各节覆盖透传', () => {
    const s = mergeConfig({
      rules: { D1: false },
      userWindowMs: 120_000,
      d1: { repeatMin: 5, exemptTexts: [' 666 ', '加油'] },
      d4: { joinsForMedium: 4 },
      d8: { minLen: 50, consecutiveMin: 4 },
      f6Mode: 'highlight',
      markHighlight: true,
      retentionDays: 3,
    })
    expect(s.rules.D1).toBe(false)
    expect(s.rules.D4).toBe(true)
    expect(s.detect.userWindowMs).toBe(120_000)
    expect(s.detect.d1.repeatMin).toBe(5)
    // 豁免名单存归一化后的文本（D1 对归一化文本判定）/ exempt texts stored normalized (D1 matches normalized text)
    expect(s.detect.d1.exemptTexts).toEqual(['666', '加油'])
    expect(s.detect.d4.joinsForMedium).toBe(4)
    expect(s.detect.d8.minLen).toBe(50)
    expect(s.detect.d8.consecutiveMin).toBe(4)
    expect(s.f6Mode).toBe('highlight')
    expect(s.markHighlight).toBe(true)
    expect(s.retentionDays).toBe(3)
  })

  test('覆盖不污染 defaultDetectConfig（唯一真源）', () => {
    mergeConfig({ d1: { repeatMin: 9 } })
    expect(defaultDetectConfig.d1.repeatMin).toBe(3)
  })
})

describe('mergeConfig 非法值拒绝（回退默认）', () => {
  test('数字阈值范围校验', () => {
    const d = defaultDetectConfig
    // 边界内接受
    expect(mergeConfig({ d1: { repeatMin: 2 } }).detect.d1.repeatMin).toBe(2)
    expect(mergeConfig({ userWindowMs: 10_000 }).detect.userWindowMs).toBe(10_000)
    expect(mergeConfig({ userWindowMs: 600_000 }).detect.userWindowMs).toBe(600_000)
    expect(mergeConfig({ retentionDays: 1 }).retentionDays).toBe(1)
    expect(mergeConfig({ retentionDays: 30 }).retentionDays).toBe(30)
    // 越界/非整数回退
    expect(mergeConfig({ d1: { repeatMin: 1 } }).detect.d1.repeatMin).toBe(d.d1.repeatMin)
    expect(mergeConfig({ d1: { repeatMin: 2.5 } }).detect.d1.repeatMin).toBe(d.d1.repeatMin)
    expect(mergeConfig({ userWindowMs: 5_000 }).detect.userWindowMs).toBe(d.userWindowMs)
    expect(mergeConfig({ userWindowMs: 601_000 }).detect.userWindowMs).toBe(d.userWindowMs)
    expect(mergeConfig({ retentionDays: 0 }).retentionDays).toBe(7)
    expect(mergeConfig({ retentionDays: 31 }).retentionDays).toBe(7)
    // joinsForMedium 不得越过 joinsForHigh（否则中等永不触发）
    expect(mergeConfig({ d4: { joinsForMedium: 1 } }).detect.d4.joinsForMedium).toBe(
      d.d4.joinsForMedium,
    )
    expect(
      mergeConfig({ d4: { joinsForMedium: d.d4.joinsForHigh + 1 } }).detect.d4.joinsForMedium,
    ).toBe(d.d4.joinsForMedium)
    expect(mergeConfig({ d8: { minLen: 9 } }).detect.d8.minLen).toBe(d.d8.minLen)
    expect(mergeConfig({ d8: { consecutiveMin: 1 } }).detect.d8.consecutiveMin).toBe(
      d.d8.consecutiveMin,
    )
  })

  test('非数字/非布尔/非枚举回退默认', () => {
    const s = mergeConfig({
      userWindowMs: '120' as never,
      rules: { D1: 'no' as never },
      f6Mode: 'blink' as never,
      markHighlight: 1 as never,
      retentionDays: '7' as never,
    })
    expect(s.detect.userWindowMs).toBe(defaultDetectConfig.userWindowMs)
    expect(s.rules.D1).toBe(true)
    expect(s.f6Mode).toBe('hide')
    expect(s.markHighlight).toBe(false)
    expect(s.retentionDays).toBe(7)
  })

  test('exemptTexts 非数组回退默认；空串被过滤', () => {
    expect(mergeConfig({ d1: { exemptTexts: 'x' as never } }).detect.d1.exemptTexts).toEqual(
      defaultDetectConfig.d1.exemptTexts,
    )
    expect(mergeConfig({ d1: { exemptTexts: ['', '  ', 'ok'] } }).detect.d1.exemptTexts).toEqual([
      'ok',
    ])
    // 空数组是合法覆盖（用户清空名单）/ empty array is a legitimate override (user cleared the list)
    expect(mergeConfig({ d1: { exemptTexts: [] } }).detect.d1.exemptTexts).toEqual([])
  })
})

describe('引擎规则开关与热更新', () => {
  test('被关规则不产生判定', () => {
    const engine = createDetectionEngine(undefined, (rule) => rule !== 'D1' && rule !== 'D0')
    for (let i = 0; i < 5; i++) engine.ingest(ev(1, '同一句话', T0 + i * 2000))
    expect(engine.getVerdict(1)).toBeUndefined()

    const e2 = createDetectionEngine(undefined, (rule) => rule !== 'D2')
    e2.ingest(ev(2, '夹带字符', T0))
    expect(e2.getVerdict(2)).toBeUndefined()
  })

  test('配置引用热更新：阈值改动即时生效，不重建引擎', () => {
    let cfg = mergeConfig({ d1: { repeatMin: 5 } }).detect
    const engine = createDetectionEngine(() => cfg)
    for (let i = 0; i < 3; i++) engine.ingest(ev(1, '同一句话', T0 + i * 2000))
    expect(engine.getVerdict(1)).toBeUndefined()
    // 调低阈值后继续喂，同一条引擎实例按新阈值出判定（仅复读信号 → D0，spec 011）
    // Lower the threshold mid-stream; the same engine instance judges by the new value (repeat-only → D0).
    cfg = mergeConfig({}).detect
    engine.ingest(ev(1, '同一句话', T0 + 6000))
    expect(engine.getVerdict(1)?.hits.find((h) => h.rule === 'D0')).toBeTruthy()
  })
})

describe('设置持久化', () => {
  test('save → load 往返；reset 后回到空覆盖', async () => {
    const db = await openDatabase()
    await resetSettings(db)
    expect(await loadSettings(db)).toEqual({})
    await saveSettings(db, { retentionDays: 3, d1: { repeatMin: 5 } })
    expect(await loadSettings(db)).toEqual({ retentionDays: 3, d1: { repeatMin: 5 } })
    await resetSettings(db)
    expect(await loadSettings(db)).toEqual({})
  })
})

// defaultSettings 引用完整性 / sanity: defaultSettings stays the fallback baseline
test('defaultSettings 与 defaultDetectConfig 一致', () => {
  expect(defaultSettings.detect).toBe(defaultDetectConfig)
  expect(defaultSettings.retentionDays).toBe(7)
})
