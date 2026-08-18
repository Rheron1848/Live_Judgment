import { describe, expect, test } from 'bun:test'
import type { UserMuteEntry } from '../../src/lib/store/usermutes'
import { isMuted } from '../../src/lib/usermute/mute'

const ROOM = 100

function entry(uid: number, roomId: number): UserMuteEntry {
  return { uid, uname: `u${uid}`, roomId, addedAt: 0 }
}

describe('按用户屏蔽判定', () => {
  test('全局名单命中（任意房间）', () => {
    expect(isMuted(7, ROOM, [entry(7, 0)])).toBe(true)
    expect(isMuted(7, 999, [entry(7, 0)])).toBe(true)
  })

  test('本房间名单命中', () => {
    expect(isMuted(8, ROOM, [entry(8, ROOM)])).toBe(true)
  })

  test('其他房间的名单不命中，未屏蔽用户不命中', () => {
    expect(isMuted(9, ROOM, [entry(9, 999)])).toBe(false)
    expect(isMuted(10, ROOM, [entry(9, 0)])).toBe(false)
    expect(isMuted(9, ROOM, [])).toBe(false)
  })

  test('解除（条目移除）后恢复不命中', () => {
    const entries = [entry(11, 0)]
    expect(isMuted(11, ROOM, entries)).toBe(true)
    expect(
      isMuted(
        11,
        ROOM,
        entries.filter((e) => e.uid !== 11),
      ),
    ).toBe(false)
  })
})
