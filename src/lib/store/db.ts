const DB_NAME = 'live-judgment'
const DB_VERSION = 5

/** 默认弹幕保留天数（7 天，2026-08-17 拍板；spec 010 起可在设置页改，1~30 天）；incidents 永久保留（spec 004 决策 5）。
 *  Default danmaku retention (7 days, decided 2026-08-17; configurable in settings since spec 010, 1~30 days); incidents are kept forever. */
export const DEFAULT_RETENTION_DAYS = 7

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
      if (event.oldVersion < 3) {
        // 按用户屏蔽只需全量列举（条目量小），不建索引。
        // User mutes are only ever listed in full (small table), so no index is created.
        db.createObjectStore('usermutes', { keyPath: 'id', autoIncrement: true })
      }
      if (event.oldVersion < 4) {
        // 官方屏蔽状态只有本地乐观记录（官方读回接口已失效），键为 uid:roomId 复合串。
        // Official-shield state is a local optimistic record (the official read-back API is dead); key is a "uid:roomId" string.
        db.createObjectStore('officialshields', { keyPath: 'key' })
      }
      if (event.oldVersion < 5) {
        // 设置覆盖项：单键一条记录（稀疏对象）/ Settings overrides: one single-key record (sparse object).
        db.createObjectStore('settings', { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 删除过期弹幕，返回删除条数；保留天数可配（spec 010），默认 7 天 / Delete danmaku older than retention (configurable days, spec 010; default 7); returns the count removed. */
export function pruneExpiredDanmaku(
  db: IDBDatabase,
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = Date.now(),
): Promise<number> {
  const cutoff = now - retentionDays * 24 * 3600 * 1000
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
