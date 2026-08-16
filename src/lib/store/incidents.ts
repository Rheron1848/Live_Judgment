import type { Confidence, RuleId } from '../detect/verdict'
import { requestToPromise, txComplete } from './db'

/** 一条违规档案：某次判定在某房间命中某规则 / One incident: a rule hit recorded in a room. */
export interface IncidentRecord {
  uid: number
  uname: string
  rule: RuleId
  confidence: Confidence
  evidence: string[]
  roomId: number
  ts: number
}

export async function addIncident(db: IDBDatabase, record: IncidentRecord): Promise<void> {
  const tx = db.transaction('incidents', 'readwrite')
  tx.objectStore('incidents').put(record)
  await txComplete(tx)
}

/** 按 uid 取全部违规档案（跨房间/跨场次累积）/ All incidents for a uid, accumulated across rooms and sessions. */
export async function incidentsByUid(db: IDBDatabase, uid: number): Promise<IncidentRecord[]> {
  const tx = db.transaction('incidents', 'readonly')
  const rows = await requestToPromise(tx.objectStore('incidents').index('uid').getAll(uid))
  return rows as IncidentRecord[]
}

/** 删除某用户的全部违规档案，返回删除条数 / Delete all incidents for a uid; returns the count removed. */
export function deleteIncidentsByUid(db: IDBDatabase, uid: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('incidents', 'readwrite')
    const index = tx.objectStore('incidents').index('uid')
    let deleted = 0
    index.openCursor(IDBKeyRange.only(uid)).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
      if (!cursor) return
      cursor.delete()
      deleted++
      cursor.continue()
    }
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
  })
}

/** 清空全部违规档案（手动清理入口，spec 004 决策 5）/ Clear all incidents (manual cleanup entry, spec 004 decision 5). */
export async function clearIncidents(db: IDBDatabase): Promise<void> {
  const tx = db.transaction('incidents', 'readwrite')
  tx.objectStore('incidents').clear()
  await txComplete(tx)
}
