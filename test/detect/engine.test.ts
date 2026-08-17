import { describe, expect, test } from 'bun:test'
import { createDetectionEngine, type UserVerdict } from '../../src/lib/detect/engine'
import { findInvisibleChars, normalizeText } from '../../src/lib/detect/normalize'
import type { DanmakuEvent } from '../../src/lib/types'

// 测试基时刻，避免依赖真实时钟 / Fixed base time so tests don't depend on the wall clock.
const T0 = 1_800_000_000_000

function ev(uid: number, text: string, ts: number): DanmakuEvent {
  return { uid, uname: `u${uid}`, text, ts, roomId: 1 }
}

function verdictOf(
  engine: ReturnType<typeof createDetectionEngine>,
  uid: number,
): UserVerdict | undefined {
  return engine.getVerdict(uid)
}

describe('normalize', () => {
  test('剔除不可见字符并折叠空白', () => {
    expect(normalizeText('  主播\u00AD牛逼 \u200B ')).toBe('主播牛逼')
    expect(normalizeText('a\uFEFFb')).toBe('ab')
  })

  test('findInvisibleChars 报告码位', () => {
    expect(findInvisibleChars('普通文本')).toEqual([])
    expect(findInvisibleChars('夹\u00AD带')).toContain('U+00AD')
  })
})

describe('D2 不可见字符', () => {
  test('单条含 U+00AD 即高置信', () => {
    const engine = createDetectionEngine()
    engine.ingest(ev(1, '这是\u00AD一条弹幕', T0))
    const v = verdictOf(engine, 1)
    expect(v?.hits).toHaveLength(1)
    expect(v?.hits[0].rule).toBe('D2')
    expect(v?.hits[0].confidence).toBe('high')
  })

  test('正常文本不命中', () => {
    const engine = createDetectionEngine()
    engine.ingest(ev(1, '普通弹幕', T0))
    expect(verdictOf(engine, 1)).toBeUndefined()
  })
})

describe('D1 独轮车复读', () => {
  test('同文本贴限速连发 5 条 → 高置信（复读+固定节拍）', () => {
    const engine = createDetectionEngine()
    for (let i = 0; i < 5; i++) {
      engine.ingest(ev(1, '主播加油', T0 + i * 1010))
    }
    const v = verdictOf(engine, 1)
    const d1 = v?.hits.find((h) => h.rule === 'D1')
    expect(d1?.confidence).toBe('high')
    expect(d1?.evidence.join()).toContain('复读')
    expect(d1?.evidence.join()).toContain('节拍')
  })

  test('第 3 条同文本到达时先给中置信', () => {
    const engine = createDetectionEngine()
    // 间隔拉开，避免节拍证据 / Spread intervals so the cadence signal doesn't fire.
    for (let i = 0; i < 3; i++) {
      engine.ingest(ev(1, '前排', T0 + i * 60_000))
    }
    const d1 = verdictOf(engine, 1)?.hits.find((h) => h.rule === 'D1')
    expect(d1?.confidence).toBe('medium')
    expect(d1?.evidence.join()).toContain('复读')
  })

  test('轮播序列 A B C A B C → 轮播证据', () => {
    const engine = createDetectionEngine()
    const seq = ['alpha', 'bravo', 'charlie', 'alpha', 'bravo', 'charlie']
    for (const [i, text] of seq.entries()) {
      engine.ingest(ev(1, text, T0 + i * 1010))
    }
    const d1 = verdictOf(engine, 1)?.hits.find((h) => h.rule === 'D1')
    expect(d1?.evidence.join()).toContain('轮播')
  })
})

describe('D4 自动融入跟风', () => {
  function buildTrend(engine: ReturnType<typeof createDetectionEngine>, text: string, t: number) {
    // 3 个不同 uid 在 15s 窗内各发 1 条，趋势在 t+2000 达成 / 3 distinct uids within the trend window.
    engine.ingest(ev(10, text, t))
    engine.ingest(ev(11, text, t + 1000))
    engine.ingest(ev(12, text, t + 2000))
  }

  test('跟风 3 个趋势 → 中置信，早期参与者无判定', () => {
    const engine = createDetectionEngine()
    const texts = ['牛逼', '666', '好好好']
    texts.forEach((text, i) => {
      const t = T0 + i * 120_000
      buildTrend(engine, text, t)
      engine.ingest(ev(99, text, t + 2500)) // 趋势达成后 0.5s 跟发 / joins 0.5s after qualification
    })
    const d4 = verdictOf(engine, 99)?.hits.find((h) => h.rule === 'D4')
    expect(d4?.confidence).toBe('medium')
    for (const uid of [10, 11, 12]) {
      expect(verdictOf(engine, uid)).toBeUndefined()
    }
  })

  test('跟风 5 个趋势 → 高置信', () => {
    const engine = createDetectionEngine()
    for (let i = 0; i < 5; i++) {
      const t = T0 + i * 120_000
      buildTrend(engine, `trend${i}`, t)
      engine.ingest(ev(99, `trend${i}`, t + 2500))
    }
    const d4 = verdictOf(engine, 99)?.hits.find((h) => h.rule === 'D4')
    expect(d4?.confidence).toBe('high')
  })

  test('跟风次数不足 3 不判定', () => {
    const engine = createDetectionEngine()
    for (let i = 0; i < 2; i++) {
      const t = T0 + i * 120_000
      buildTrend(engine, `trend${i}`, t)
      engine.ingest(ev(99, `trend${i}`, t + 2500))
    }
    expect(verdictOf(engine, 99)).toBeUndefined()
  })
})

describe('防误报', () => {
  test('正常对话流零判定', () => {
    const engine = createDetectionEngine()
    // 5 个用户、各自不同话题；每用户独立时间线，间隔取自散乱表，最后按时间合并排序。
    // 5 users with distinct topics; per-user timelines with scattered gaps, merge-sorted by time.
    const gaps = [2500, 9000, 16000, 3200, 21000, 5000, 12000, 27000, 4200, 18000]
    const events: DanmakuEvent[] = []
    for (let uid = 1; uid <= 5; uid++) {
      let ts = T0
      for (let round = 0; round < 10; round++) {
        ts += gaps[(uid * 3 + round * 7) % gaps.length]
        events.push(ev(uid, `用户${uid}第${round}条 unique-${uid}-${round}`, ts))
      }
    }
    events.sort((a, b) => a.ts - b.ts)
    for (const e of events) engine.ingest(e)
    for (let uid = 1; uid <= 5; uid++) {
      expect(verdictOf(engine, uid)).toBeUndefined()
    }
  })

  test('多人同时聊同一话题（非刷屏密度）不判 D4', () => {
    const engine = createDetectionEngine()
    // 3 人各发 1 条相同文本但间隔 20s，超出 15s 趋势窗 / Same text but outside the trend window.
    engine.ingest(ev(1, '这操作可以', T0))
    engine.ingest(ev(2, '这操作可以', T0 + 20_000))
    engine.ingest(ev(3, '这操作可以', T0 + 40_000))
    engine.ingest(ev(4, '这操作可以', T0 + 41_000))
    expect(verdictOf(engine, 4)).toBeUndefined()
  })
})

describe('D8 长文无关刷屏', () => {
  // 上下文：其他用户在聊主播/游戏 / Context: other users chatting about the streamer/game.
  const CONTEXT = ['主播这波操作太秀了', '游戏节奏起来了', '主播今天状态无敌', '哈哈哈哈', '666']
  // 三条互不相似的长古文（与上下文零重合）/ Three mutually dissimilar long off-topic texts.
  const OFFTOPIC = [
    '乾坤倒置江河逆流日月无光星辰陨落山河破碎草木枯荣鸟兽散尽风雨飘摇',
    '洪荒初开混沌未分阴阳交错五行颠倒四时失序万物凋零天地悲鸣鬼神皆惊',
    '玄黄未定清浊难分龙蛇起陆虎豹潜形鹰隼试翼风尘吸张奇花初胎矞矞皇皇',
  ]

  function feedContext(engine: ReturnType<typeof createDetectionEngine>, t: number) {
    for (const [i, text] of CONTEXT.entries()) engine.ingest(ev(10 + i, text, t + i * 3000))
  }

  test('连发 3 条长且无关 → D8 中置信', () => {
    const engine = createDetectionEngine()
    feedContext(engine, T0)
    for (const [i, text] of OFFTOPIC.entries()) engine.ingest(ev(1, text, T0 + 20_000 + i * 5000))
    const d8 = verdictOf(engine, 1)?.hits.find((h) => h.rule === 'D8')
    expect(d8?.confidence).toBe('medium')
  })

  test('长但与上下文共享话题词 → 不命中', () => {
    const engine = createDetectionEngine()
    feedContext(engine, T0)
    const onTopic = '主播这波的游戏节奏和状态真的好无敌啊观众们都看得目瞪口呆纷纷点赞'
    for (let i = 0; i < 3; i++) engine.ingest(ev(1, `${onTopic}${i}`, T0 + 20_000 + i * 5000))
    expect(verdictOf(engine, 1)?.hits.find((h) => h.rule === 'D8')).toBeUndefined()
  })

  test('只有 2 条长文无关 → 不命中', () => {
    const engine = createDetectionEngine()
    feedContext(engine, T0)
    for (const [i, text] of OFFTOPIC.slice(0, 2).entries())
      engine.ingest(ev(1, text, T0 + 20_000 + i * 5000))
    expect(verdictOf(engine, 1)?.hits.find((h) => h.rule === 'D8')).toBeUndefined()
  })

  test('房间中位数抬高长度阈值：全场长文时 50 字不算长', () => {
    const engine = createDetectionEngine()
    // 25 条 40 字消息垫高中位数 → 阈值 2×40=80 字 / 25 messages of 40 chars raise the median, threshold becomes 80.
    const filler = '甲乙丙丁戊己庚辛壬癸'.repeat(4)
    for (let i = 0; i < 25; i++) engine.ingest(ev(10 + (i % 5), filler, T0 + i * 1000))
    // 50 字长文，低于 80 字阈值 / 50-char texts, below the 80-char threshold.
    for (const [i, ch] of ['乾', '坤', '震'].entries()) {
      engine.ingest(ev(1, ch.repeat(50), T0 + 30_000 + i * 5000))
    }
    expect(verdictOf(engine, 1)?.hits.find((h) => h.rule === 'D8')).toBeUndefined()
  })
})
