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
