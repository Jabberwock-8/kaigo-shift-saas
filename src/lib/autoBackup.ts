/**
 * 採択後の自動バックアップ（施設データの引っ越しと同じ形式のJSONを保存する）。
 * 保存先は既定でブラウザのダウンロードフォルダ。保存先フォルダを選んでいれば、そのフォルダへ直接書き込む。
 * フォルダの指定は端末（ブラウザ）ごとに IndexedDB へ保存する。docs/remaining-work-design.md §14 参照。
 */
import { exportFacilityData } from './facilityTransfer'

// File System Access API は TypeScript の標準型に無いため、使う分だけ宣言する
type PermissionMode = { mode: 'readwrite' }
interface DirHandle {
  name: string
  queryPermission(opts: PermissionMode): Promise<PermissionState>
  requestPermission(opts: PermissionMode): Promise<PermissionState>
  getFileHandle(name: string, opts: { create: true }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
  }>
}
type PickerOptions = PermissionMode & { id?: string; startIn?: 'downloads' | 'documents' | 'desktop' }
type WindowWithPicker = Window & { showDirectoryPicker?: (opts: PickerOptions) => Promise<DirHandle> }

const DB_NAME = 'shift-maker-backup'
const STORE = 'handles'
const KEY = 'backupDir'

/** フォルダを選べるブラウザか（Chrome / Edge のみ。Firefox・Safari はダウンロードフォルダのみ） */
export function canPickBackupFolder() {
  return typeof (window as WindowWithPicker).showDirectoryPicker === 'function'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function loadHandle(): Promise<DirHandle | null> {
  try {
    return ((await withStore('readonly', (s) => s.get(KEY))) as DirHandle | undefined) ?? null
  } catch {
    return null
  }
}

/** 選んである保存先フォルダの名前（未指定なら null ＝ダウンロードフォルダ） */
export async function getBackupFolderName(): Promise<string | null> {
  return (await loadHandle())?.name ?? null
}

/** 保存先フォルダを選ぶ。キャンセルされたら null */
export async function pickBackupFolder(): Promise<string | null> {
  const picker = (window as WindowWithPicker).showDirectoryPicker
  if (!picker) return null
  try {
    // ブラウザの制限で「ダウンロード」「ドキュメント」「デスクトップ」そのものは選べない（システムファイルを含むため）。
    // ダウンロードフォルダで開き、その中に新しいフォルダを作って選んでもらう
    const handle = await picker({ mode: 'readwrite', id: 'shift-backup', startIn: 'downloads' })
    await withStore('readwrite', (s) => s.put(handle, KEY))
    return handle.name
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

/** 保存先をダウンロードフォルダに戻す */
export async function clearBackupFolder() {
  await withStore('readwrite', (s) => s.delete(KEY))
}

/**
 * 保存先フォルダへの書き込み許可を確認し、必要なら求める。
 * 許可の確認はボタンを押した直後（ユーザー操作の中）でないと出せないため、採択ボタンの処理の最初に呼ぶ。
 * 許可が得られなければ false（そのときはダウンロードフォルダへ保存する）。
 */
export async function prepareBackupFolder(): Promise<boolean> {
  const handle = await loadHandle()
  if (!handle) return false
  try {
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** ファイル名に使えない文字を置き換える */
function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, '_')
}

export function backupFileName(facilityName: string, yearMonth: string, now: Date) {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
  return `施設データ_${safeName(facilityName)}_${yearMonth}採択_${stamp}.json`
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 施設データを書き出して保存する。保存先を返す（画面の案内用）。
 * useFolder が true でもフォルダへの書き込みに失敗したら、ダウンロードフォルダへ保存し直す。
 */
export async function saveFacilityBackup(
  facilityId: string,
  facilityName: string,
  yearMonth: string,
  useFolder: boolean,
): Promise<{ fileName: string; savedTo: string }> {
  const data = await exportFacilityData(facilityId)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const fileName = backupFileName(facilityName, yearMonth, new Date())

  if (useFolder) {
    const handle = await loadHandle()
    if (handle) {
      try {
        const writable = await (await handle.getFileHandle(fileName, { create: true })).createWritable()
        await writable.write(blob)
        await writable.close()
        return { fileName, savedTo: `フォルダ「${handle.name}」` }
      } catch {
        // フォルダが消された・移動された等。ダウンロードで取りこぼさないようにする
      }
    }
  }
  download(blob, fileName)
  return { fileName, savedTo: 'ダウンロードフォルダ' }
}
