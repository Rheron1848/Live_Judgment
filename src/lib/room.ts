/** 从直播间 URL 解析房间号 / Parse the room id from a live-room URL. */
export function parseRoomId(pathname: string): number | null {
  // 形如 /12345 或 /blanc/12345 / e.g. /12345 or /blanc/12345
  const m = pathname.match(/^\/(?:blanc\/)?(\d+)/)
  return m ? Number(m[1]) : null
}
