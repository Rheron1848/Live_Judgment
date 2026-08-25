import { type ActionResult, postForm } from './http'

const URL = 'https://api.live.bilibili.com/xlive/web-ucenter/v1/banned/AddSilentUser'

/** 无房管权限时 B 站返回的错误码（实测：「你不是房管哦」）/ Bilibili's error code when the caller is not a room admin ("你不是房管哦"). */
export const NO_PERMISSION_CODE = 100004

/** 禁言表单字段（房管接口；hour=-1 永久）。无权限时接口回 NO_PERMISSION_CODE，由 UI 置灰。
 *  Silence form fields (room-admin API; hour=-1 means permanent). Without permission the API returns NO_PERMISSION_CODE and the UI greys out. */
export function buildSilenceFields(roomId: number, tuid: number): Record<string, string | number> {
  return { room_id: roomId, tuid, mobile_app: 'web', type: 1, hour: -1 }
}

export async function silenceUser(roomId: number, tuid: number): Promise<ActionResult> {
  return postForm(URL, buildSilenceFields(roomId, tuid))
}
