import { requestToPromise, txComplete } from './db'

interface RoomCache {
  roomId: number
  anchorName: string
  fetchedAt: number
}

/** 解析房间号 → 主播名，结果缓存进 rooms store；失败返回 null，调用方降级显示房间号 / Resolve room id → anchor name, cached in the rooms store; null on failure (caller falls back to the room id). */
export async function resolveAnchorName(db: IDBDatabase, roomId: number): Promise<string | null> {
  const cached = (await requestToPromise(
    db.transaction('rooms', 'readonly').objectStore('rooms').get(roomId),
  )) as RoomCache | undefined
  if (cached) return cached.anchorName

  try {
    const resp = await fetch(
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${roomId}`,
      { credentials: 'include' },
    )
    const json = await resp.json()
    const name: string | null = json?.data?.anchor_info?.base_info?.uname ?? null
    if (name) {
      const tx = db.transaction('rooms', 'readwrite')
      tx.objectStore('rooms').put({ roomId, anchorName: name, fetchedAt: Date.now() })
      await txComplete(tx)
    }
    return name
  } catch {
    return null
  }
}
