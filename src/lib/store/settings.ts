import type { SettingsOverride } from '../settings/config'
import { requestToPromise, txComplete } from './db'

// 单键存储：整份覆盖对象一条记录（设置量小，读全量替换即可）。
// Single-key store: the whole override object is one record (settings are small; read-all/replace is fine).
const SETTINGS_KEY = 'user'

interface SettingsRecord {
  key: string
  override: SettingsOverride
}

/** 读取用户覆盖项；无记录返回空对象 / Load user overrides; empty object when nothing is stored. */
export async function loadSettings(db: IDBDatabase): Promise<SettingsOverride> {
  const tx = db.transaction('settings', 'readonly')
  const rec = (await requestToPromise(tx.objectStore('settings').get(SETTINGS_KEY))) as
    | SettingsRecord
    | undefined
  return rec?.override ?? {}
}

export async function saveSettings(db: IDBDatabase, override: SettingsOverride): Promise<void> {
  const tx = db.transaction('settings', 'readwrite')
  tx.objectStore('settings').put({ key: SETTINGS_KEY, override })
  await txComplete(tx)
}

export async function resetSettings(db: IDBDatabase): Promise<void> {
  const tx = db.transaction('settings', 'readwrite')
  tx.objectStore('settings').delete(SETTINGS_KEY)
  await txComplete(tx)
}
