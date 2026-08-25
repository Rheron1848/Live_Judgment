import { requestToPromise, txComplete } from './db'

/** 官方屏蔽的本地乐观状态（官方读回接口已失效，以最后一次本地操作为准）。
 *  Local optimistic state for official shield (the official read-back API is dead; last local operation wins). */
export interface OfficialShieldEntry {
  /** `${uid}:${roomId}` / Composite key. */
  key: string
  uid: number
  roomId: number
  shielded: boolean
  updatedAt: number
}

export function officialShieldKey(uid: number, roomId: number): string {
  return `${uid}:${roomId}`
}

export async function listOfficialShields(db: IDBDatabase): Promise<OfficialShieldEntry[]> {
  const tx = db.transaction('officialshields', 'readonly')
  return (await requestToPromise(
    tx.objectStore('officialshields').getAll(),
  )) as OfficialShieldEntry[]
}

export async function setOfficialShield(
  db: IDBDatabase,
  uid: number,
  roomId: number,
  shielded: boolean,
): Promise<void> {
  const tx = db.transaction('officialshields', 'readwrite')
  tx.objectStore('officialshields').put({
    key: officialShieldKey(uid, roomId),
    uid,
    roomId,
    shielded,
    updatedAt: Date.now(),
  })
  await txComplete(tx)
}
