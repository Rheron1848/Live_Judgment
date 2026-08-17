import { requestToPromise, txComplete } from './db'

/** 用户自定义屏蔽词条目；roomId = 0 表示全局组（索引键不宜用 null，用 0 约定）。
 *  User-defined block-word entry; roomId = 0 means the global group (index keys avoid null). */
export interface BlockWordEntry {
  id?: number
  word: string
  isRegex: boolean
  roomId: number
}

export async function listBlockWords(db: IDBDatabase): Promise<BlockWordEntry[]> {
  const tx = db.transaction('blockwords', 'readonly')
  return (await requestToPromise(tx.objectStore('blockwords').getAll())) as BlockWordEntry[]
}

/** 写入词条并返回自增 id / Add an entry and resolve with its auto-incremented id. */
export async function addBlockWord(db: IDBDatabase, entry: BlockWordEntry): Promise<number> {
  const tx = db.transaction('blockwords', 'readwrite')
  const req = tx.objectStore('blockwords').add(entry)
  await txComplete(tx)
  return req.result as number
}

export async function removeBlockWord(db: IDBDatabase, id: number): Promise<void> {
  const tx = db.transaction('blockwords', 'readwrite')
  tx.objectStore('blockwords').delete(id)
  await txComplete(tx)
}
