import { describe, expect, test } from 'bun:test'
import { compileBlockWords } from '../../src/lib/blockword/matcher'
import type { BlockWordEntry } from '../../src/lib/store/blockwords'

const ROOM = 100

function entry(word: string, isRegex = false, roomId = 0): BlockWordEntry {
  return { word, isRegex, roomId }
}

describe('屏蔽词匹配器', () => {
  test('普通词命中与不命中', () => {
    const m = compileBlockWords([entry('广告')], ROOM)
    expect(m.test('这条是广告弹幕')).toBe(true)
    expect(m.test('正常聊天内容')).toBe(false)
  })

  test('普通词大小写不敏感', () => {
    const m = compileBlockWords([entry('AbC')], ROOM)
    expect(m.test('xx abc xx')).toBe(true)
    expect(m.test('xx ABC xx')).toBe(true)
  })

  test('正则词命中', () => {
    const m = compileBlockWords([entry('^刷\\d+$', true)], ROOM)
    expect(m.test('刷123')).toBe(true)
    expect(m.test('刷abc')).toBe(false)
  })

  test('非法正则降级为字面包含', () => {
    const m = compileBlockWords([entry('a[', true)], ROOM)
    expect(m.test('文本里有 a[ 字面')).toBe(true)
    expect(m.test('普通文本')).toBe(false)
  })

  test('作用域：全局组与当前房间组参与匹配，其他房间不参与', () => {
    const m = compileBlockWords(
      [entry('全局词', false, 0), entry('本房间词', false, ROOM), entry('别房间词', false, 999)],
      ROOM,
    )
    expect(m.test('出现全局词')).toBe(true)
    expect(m.test('出现本房间词')).toBe(true)
    expect(m.test('出现别房间词')).toBe(false)
  })

  test('空表不隐藏任何文本', () => {
    const m = compileBlockWords([], ROOM)
    expect(m.test('任意弹幕内容')).toBe(false)
  })
})
