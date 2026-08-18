import type { UserMuteEntry } from '../store/usermutes'

/**
 * 判定某 uid 是否被屏蔽：全局名单（roomId=0）∪ 当前房间名单命中即隐藏；其他房间的名单不参与。
 * Whether a uid is muted: hits from the global list (roomId=0) or the current room's list; other rooms never match.
 */
export function isMuted(uid: number, currentRoomId: number, entries: UserMuteEntry[]): boolean {
  return entries.some((e) => e.uid === uid && (e.roomId === 0 || e.roomId === currentRoomId))
}
