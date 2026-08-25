import { type ActionResult, postForm } from './http'

const URL = 'https://api.live.bilibili.com/liveact/shield_user'

/** 官方屏蔽（个人级，可逆）：type=1 屏蔽 / 0 解除。生效语义是服务端对「新会话」过滤，不保证当前会话立即消失。
 *  Official shield (personal-level, reversible): type=1 shield / 0 unshield. Takes effect on new sessions, not necessarily the current one. */
export function buildShieldFields(
  uid: number,
  roomId: number,
  shield: boolean,
): Record<string, string | number> {
  return { uid, roomid: roomId, type: shield ? 1 : 0, visit_id: '' }
}

export async function shieldUser(
  uid: number,
  roomId: number,
  shield: boolean,
): Promise<ActionResult> {
  return postForm(URL, buildShieldFields(uid, roomId, shield))
}
