import { describe, expect, test } from 'bun:test'
import 'fake-indexeddb/auto'
import { DanmakuBuffer, danmakuByUid } from '../../src/lib/store/danmaku'
import { openDatabase, pruneExpiredDanmaku } from '../../src/lib/store/db'
import { addIncident, incidentsByUid } from '../../src/lib/store/incidents'
import { addToWatchlist, listWatchlist, removeFromWatchlist } from '../../src/lib/store/watchlist'

const NOW = 1_800_000_000_000
const DAY = 24 * 3600 * 1000

// 每个用例全新库，互不影响 / Fresh database per test case.
async function freshDb(): Promise<IDBDatabase> {
  const db = await openDatabase()
  for (const name of ['danmaku', 'incidents', 'watchlist', 'rooms'] as const) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite')
      tx.objectStore(name).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
  return db
}

describe('danmaku 记录', () => {
  test('缓冲批量写入后可按 uid 倒序查询', async () => {
    const db = await freshDb()
    const buffer = new DanmakuBuffer(db)
    for (let i = 0; i < 5; i++) {
      buffer.push({ uid: 7, uname: 'u7', text: `m${i}`, roomId: 1, ts: NOW + i })
    }
    buffer.push({ uid: 8, uname: 'u8', text: 'other', roomId: 1, ts: NOW })
    await buffer.flush()

    const rows = await danmakuByUid(db, 7)
    expect(rows).toHaveLength(5)
    expect(rows[0].text).toBe('m4') // 最新在前 / newest first
    expect(rows[4].text).toBe('m0')
  })

  test('启动清理只删过期弹幕（7 天），incidents 不受影响', async () => {
    const db = await freshDb()
    const buffer = new DanmakuBuffer(db)
    buffer.push({ uid: 1, uname: 'u', text: 'old', roomId: 1, ts: NOW - 8 * DAY })
    buffer.push({ uid: 1, uname: 'u', text: 'new', roomId: 1, ts: NOW })
    await buffer.flush()
    await addIncident(db, {
      uid: 1,
      uname: 'u',
      rule: 'D1',
      confidence: 'high',
      evidence: ['e'],
      roomId: 1,
      ts: NOW - 30 * DAY,
    })

    const deleted = await pruneExpiredDanmaku(db, 7, NOW)
    expect(deleted).toBe(1)
    expect(await danmakuByUid(db, 1)).toHaveLength(1)
    expect(await incidentsByUid(db, 1)).toHaveLength(1)
  })
})

describe('incidents 违规档案', () => {
  test('按 uid 聚合多场次的违规记录', async () => {
    const db = await freshDb()
    await addIncident(db, {
      uid: 9,
      uname: 'bot',
      rule: 'D1',
      confidence: 'high',
      evidence: ['复读'],
      roomId: 100,
      ts: NOW - DAY,
    })
    await addIncident(db, {
      uid: 9,
      uname: 'bot',
      rule: 'D4',
      confidence: 'medium',
      evidence: ['跟风 3 次'],
      roomId: 200,
      ts: NOW,
    })
    const rows = await incidentsByUid(db, 9)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.roomId).sort()).toEqual([100, 200])
  })
})

describe('watchlist 人工名单', () => {
  test('增删查', async () => {
    const db = await freshDb()
    await addToWatchlist(db, {
      uid: 5,
      uname: 'u5',
      addedAt: NOW,
      fromRoomId: 1,
      note: '独轮车惯犯',
    })
    expect(await listWatchlist(db)).toHaveLength(1)
    await removeFromWatchlist(db, 5)
    expect(await listWatchlist(db)).toHaveLength(0)
  })

  test('重复加入覆盖更新', async () => {
    const db = await freshDb()
    await addToWatchlist(db, { uid: 5, uname: 'u5', addedAt: NOW, fromRoomId: 1 })
    await addToWatchlist(db, { uid: 5, uname: 'u5-new', addedAt: NOW + 1, fromRoomId: 2 })
    const list = await listWatchlist(db)
    expect(list).toHaveLength(1)
    expect(list[0].uname).toBe('u5-new')
  })
})
