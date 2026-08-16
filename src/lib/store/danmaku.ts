import { txComplete } from './db'

/** 一条弹幕记录 / One stored danmaku record. */
export interface DanmakuRecord {
  uid: number
  uname: string
  text: string
  roomId: number
  ts: number
}

/** 弹幕写入缓冲：定时/定量批量落库，避免高刷屏房间逐条开事务 / Buffered batch writer: flush by time or count to avoid per-message transactions in busy rooms. */
export class DanmakuBuffer {
  private buf: DanmakuRecord[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly db: IDBDatabase,
    private readonly flushIntervalMs = 2000,
    private readonly flushCount = 50,
  ) {}

  push(record: DanmakuRecord): void {
    this.buf.push(record)
    if (this.buf.length >= this.flushCount) {
      void this.flush()
    } else if (this.timer === null) {
      this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs)
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buf.length === 0) return
    const batch = this.buf.splice(0)
    const tx = this.db.transaction('danmaku', 'readwrite')
    const store = tx.objectStore('danmaku')
    for (const record of batch) store.put(record)
    await txComplete(tx)
  }
}

/** 按 uid 查弹幕，最新在前 / Danmaku by uid, newest first. */
export function danmakuByUid(db: IDBDatabase, uid: number, limit = 100): Promise<DanmakuRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('danmaku', 'readonly')
    const index = tx.objectStore('danmaku').index('uid_ts')
    const rows: DanmakuRecord[] = []
    index.openCursor(
      IDBKeyRange.bound([uid, 0], [uid, Number.MAX_SAFE_INTEGER]),
      'prev',
    ).onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
      if (!cursor || rows.length >= limit) return
      rows.push(cursor.value as DanmakuRecord)
      cursor.continue()
    }
    tx.oncomplete = () => resolve(rows)
    tx.onerror = () => reject(tx.error)
  })
}
