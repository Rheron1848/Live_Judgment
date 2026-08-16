import { requestToPromise, txComplete } from './db'

/** 人工确认名单条目；自动检测永不写入（spec 004）/ Manual watchlist entry; the detector never writes here. */
export interface WatchlistEntry {
  uid: number
  uname: string
  addedAt: number
  /** 加入时所在房间 / Room where the entry was added. */
  fromRoomId: number
  note?: string
}

export async function addToWatchlist(db: IDBDatabase, entry: WatchlistEntry): Promise<void> {
  const tx = db.transaction('watchlist', 'readwrite')
  tx.objectStore('watchlist').put(entry)
  await txComplete(tx)
}

export async function removeFromWatchlist(db: IDBDatabase, uid: number): Promise<void> {
  const tx = db.transaction('watchlist', 'readwrite')
  tx.objectStore('watchlist').delete(uid)
  await txComplete(tx)
}

export async function listWatchlist(db: IDBDatabase): Promise<WatchlistEntry[]> {
  const tx = db.transaction('watchlist', 'readonly')
  return (await requestToPromise(tx.objectStore('watchlist').getAll())) as WatchlistEntry[]
}
