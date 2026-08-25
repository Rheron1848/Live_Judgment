import { describe, expect, test } from 'bun:test'
import 'fake-indexeddb/auto'
import { buildBlockFields, parseBlocked } from '../../src/lib/action/block'
import { buildFormBody, normalizeResult } from '../../src/lib/action/http'
import { buildShieldFields } from '../../src/lib/action/shield'
import { buildSilenceFields, NO_PERMISSION_CODE } from '../../src/lib/action/silence'
import { openDatabase } from '../../src/lib/store/db'
import { listOfficialShields, setOfficialShield } from '../../src/lib/store/officialshields'

describe('官方处置请求表单构造', () => {
  test('buildFormBody 携带全部字段并自动补 csrf/csrf_token', () => {
    const body = buildFormBody({ uid: 42, roomid: 100, type: 1, visit_id: '' }, 'CSRF')
    const p = new URLSearchParams(body)
    expect(p.get('uid')).toBe('42')
    expect(p.get('roomid')).toBe('100')
    expect(p.get('type')).toBe('1')
    expect(p.get('visit_id')).toBe('')
    expect(p.get('csrf')).toBe('CSRF')
    expect(p.get('csrf_token')).toBe('CSRF')
  })

  test('官方屏蔽 shield_user：type 1 屏蔽 / 0 解除', () => {
    expect(buildShieldFields(42, 100, true)).toEqual({
      uid: 42,
      roomid: 100,
      type: 1,
      visit_id: '',
    })
    expect(buildShieldFields(42, 100, false).type).toBe(0)
  })

  test('拉黑 relation/modify：act 5 拉黑 / 6 解除', () => {
    expect(buildBlockFields(42, true).act).toBe(5)
    expect(buildBlockFields(42, false).act).toBe(6)
    expect(buildBlockFields(42, true).fid).toBe(42)
  })

  test('禁言 AddSilentUser：tuid/room_id/type=1/hour=-1 永久', () => {
    expect(buildSilenceFields(100, 42)).toEqual({
      room_id: 100,
      tuid: 42,
      mobile_app: 'web',
      type: 1,
      hour: -1,
    })
    expect(NO_PERMISSION_CODE).toBe(100004)
  })
})

describe('响应归一化', () => {
  test('code 0 为成功', () => {
    expect(normalizeResult({ code: 0, message: '' })).toEqual({ ok: true, code: 0, message: '' })
  })

  test('非 0 透传 message，msg 兜底', () => {
    expect(normalizeResult({ code: 100004, message: '你不是房管哦' })).toEqual({
      ok: false,
      code: 100004,
      message: '你不是房管哦',
    })
    expect(normalizeResult({ code: 1, msg: '参数错误', message: '' }).message).toBe('参数错误')
  })

  test('异常结构不抛错', () => {
    const r = normalizeResult(null)
    expect(r.ok).toBe(false)
  })
})

describe('拉黑状态解析', () => {
  test('attribute=128 为已拉黑，其余为未拉黑', () => {
    expect(parseBlocked({ code: 0, data: { attribute: 128 } })).toBe(true)
    expect(parseBlocked({ code: 0, data: { attribute: 2 } })).toBe(false)
    expect(parseBlocked({ code: 0, data: { attribute: 0 } })).toBe(false)
  })

  test('查询失败（非 0 code / 异常结构）返回 undefined', () => {
    expect(parseBlocked({ code: -101, message: '账号未登录' })).toBeUndefined()
    expect(parseBlocked(null)).toBeUndefined()
  })
})

describe('官方屏蔽状态本地持久化', () => {
  test('set/list 往返；同 uid 不同房间互不影响；覆盖写以最后一次为准', async () => {
    const db = await openDatabase()
    await setOfficialShield(db, 42, 100, true)
    await setOfficialShield(db, 42, 200, false)
    let list = await listOfficialShields(db)
    expect(list.find((e) => e.uid === 42 && e.roomId === 100)?.shielded).toBe(true)
    expect(list.find((e) => e.uid === 42 && e.roomId === 200)?.shielded).toBe(false)

    await setOfficialShield(db, 42, 100, false)
    list = await listOfficialShields(db)
    expect(list.find((e) => e.uid === 42 && e.roomId === 100)?.shielded).toBe(false)
  })
})
