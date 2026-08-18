import { requestToPromise, txComplete } from './db'

/** 按用户屏蔽条目；roomId = 0 表示全局组（与 blockwords 同约定）。
 *  Per-user mute entry; roomId = 0 means the global group (same convention as blockwords). */
export interface UserMuteEntry {
  id?: number
  uid: number
  uname: string
  roomId: number
  addedAt: number
}

export async function listUserMutes(db: IDBDatabase): Promise<UserMuteEntry[]> {
  const tx = db.transaction('usermutes', 'readonly')
  return (await requestToPromise(tx.objectStore('usermutes').getAll())) as UserMuteEntry[]
}

/** 写入条目并返回自增 id / Add an entry and resolve with its auto-incremented id. */
export async function addUserMute(db: IDBDatabase, entry: UserMuteEntry): Promise<number> {
  const tx = db.transaction('usermutes', 'readwrite')
  const req = tx.objectStore('usermutes').add(entry)
  await txComplete(tx)
  return req.result as number
}

export async function removeUserMute(db: IDBDatabase, id: number): Promise<void> {
  const tx = db.transaction('usermutes', 'readwrite')
  tx.objectStore('usermutes').delete(id)
  await txComplete(tx)
}
