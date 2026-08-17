const DB_NAME = 'live-judgment'
const DB_VERSION = 2

/** 弹幕记录保留时长（7 天）；incidents 永久保留（spec 004 决策 5）/ Danmaku retention (7 days); incidents are kept forever. */
export const DANMAKU_RETENTION_MS = 7 * 24 * 3600 * 1000

/** 打开（必要时初始化）IndexedDB / Open (and initialize if needed) the IndexedDB database. */
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      // 增量迁移：只补建旧版本缺失的 store，已有数据保留。
      // Incremental migration: only create stores missing from the old version; existing data is kept.
      if (event.oldVersion < 1) {
        const danmaku = db.createObjectStore('danmaku', { keyPath: 'id', autoIncrement: true })
        danmaku.createIndex('uid_ts', ['uid', 'ts'])
        danmaku.createIndex('room_ts', ['roomId', 'ts'])
        danmaku.createIndex('ts', 'ts')
        const incidents = db.createObjectStore('incidents', { keyPath: 'id', autoIncrement: true })
        incidents.createIndex('uid', 'uid')
        incidents.createIndex('ts', 'ts')
        db.createObjectStore('watchlist', { keyPath: 'uid' })
        db.createObjectStore('rooms', { keyPath: 'roomId' })
      }
      if (event.oldVersion < 2) {
        const blockwords = db.createObjectStore('blockwords', {
          keyPath: 'id',
          autoIncrement: true,
        })
        blockwords.createIndex('room', 'roomId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 删除过期弹幕，返回删除条数 / Delete danmaku older than retention; returns the count removed. */
export function pruneExpiredDanmaku(db: IDBDatabase, now = Date.now()): Promise<number> {
  const cutoff = now - DANMAKU_RETENTION_MS
  return new Promise((resolve, reject) => {
    const tx = db.transaction('danmaku', 'readwrite')
    const index = tx.objectStore('danmaku').index('ts')
    let deleted = 0
    index.openCursor(IDBKeyRange.upperBound(cutoff, true)).onsuccess = (event) => {
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

/** IDBRequest → Promise / Wrap an IDBRequest in a Promise. */
export function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 等待事务完成 / Resolve when the transaction completes. */
export function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
