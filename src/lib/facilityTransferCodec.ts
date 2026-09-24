/**
 * 施設データの引っ越し（dev → prod）用ファイルの形式と、変換・検証の純関数。
 * Firestore への読み書きは facilityTransfer.ts 側で行う。docs/remaining-work-design.md §12 参照。
 */
import { Timestamp } from 'firebase/firestore'

export const TRANSFER_FORMAT = 'kaigo-shift-saas/facility-data'
export const TRANSFER_VERSION = 1

/**
 * 引っ越しの対象にする施設のサブコレクション。
 * schedules の下の candidates（生成した案の控え）は採択前の一時データなので対象外。
 */
export const TRANSFER_COLLECTIONS = [
  'jobTypes',
  'employmentTypes',
  'shiftPatterns',
  'staff',
  'rules',
  'compatibilities',
  'settings',
  'schedules',
  'leaveRequests',
] as const

export type TransferCollection = (typeof TRANSFER_COLLECTIONS)[number]

export const TRANSFER_COLLECTION_LABELS: Record<TransferCollection, string> = {
  jobTypes: '職種',
  employmentTypes: '雇用区分',
  shiftPatterns: '勤務パターン',
  staff: '職員',
  rules: '条件',
  compatibilities: '相性',
  settings: '設定',
  schedules: '勤務表（月）',
  leaveRequests: '希望休・有給',
}

/** ドキュメントID → 中身（JSONにできる形へ変換済み） */
export type TransferDocs = Record<string, Record<string, unknown>>

export interface FacilityTransferFile {
  format: typeof TRANSFER_FORMAT
  version: typeof TRANSFER_VERSION
  /** 書き出した日時（ISO 8601） */
  exportedAt: string
  /** 書き出し元の Firebase プロジェクトID（同じ環境へ読み込もうとしたときの警告に使う） */
  sourceProjectId: string | null
  facility: { id: string; name: string; shortName?: string }
  collections: Record<TransferCollection, TransferDocs>
}

const TIMESTAMP_KEY = '__timestamp__'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Firestore から読んだ値を JSON にできる形へ変換する。未対応の型は黙って壊さず止める */
export function encodeValue(v: unknown): unknown {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`書き出せない数値があります（${v}）`)
    return v
  }
  if (v instanceof Timestamp) return { [TIMESTAMP_KEY]: { seconds: v.seconds, nanoseconds: v.nanoseconds } }
  if (Array.isArray(v)) return v.map(encodeValue)
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encodeValue(x)]))
  throw new Error(`書き出せない種類の値があります（${Object.prototype.toString.call(v)}）`)
}

/** encodeValue の逆。日時の目印が付いた値を Firestore の Timestamp に戻す */
export function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decodeValue)
  if (isPlainObject(v)) {
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === TIMESTAMP_KEY) {
      const ts = v[TIMESTAMP_KEY] as { seconds?: unknown; nanoseconds?: unknown }
      if (typeof ts?.seconds !== 'number' || typeof ts?.nanoseconds !== 'number') {
        throw new Error('ファイル内の日時の形式が正しくありません')
      }
      return new Timestamp(ts.seconds, ts.nanoseconds)
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decodeValue(x)]))
  }
  return v
}

/** 1ドキュメント分の中身を変換する（ドキュメントの中身は必ずオブジェクト） */
export function encodeDoc(data: Record<string, unknown>): Record<string, unknown> {
  return encodeValue(data) as Record<string, unknown>
}

export function decodeDoc(data: Record<string, unknown>): Record<string, unknown> {
  return decodeValue(data) as Record<string, unknown>
}

/**
 * 読み込んだファイルの中身を検証して型付きで返す。問題があれば利用者向けの日本語メッセージで止める。
 * 対象外の名前のコレクションは無視し、欠けているコレクションは空として扱う（ファイルに無い＝0件）。
 */
export function parseTransferFile(text: string): FacilityTransferFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('ファイルを読み取れませんでした。「書き出す」で保存したファイル（.json）を選んでください。')
  }
  if (!isPlainObject(raw) || raw.format !== TRANSFER_FORMAT) {
    throw new Error('施設データのファイルではありません。「書き出す」で保存したファイルを選んでください。')
  }
  if (raw.version !== TRANSFER_VERSION) {
    throw new Error(`このファイルの形式（版 ${String(raw.version)}）には対応していません。アプリを最新にしてから書き出し直してください。`)
  }
  const facility = raw.facility
  if (!isPlainObject(facility) || typeof facility.id !== 'string' || !facility.id || typeof facility.name !== 'string') {
    throw new Error('ファイルに施設の情報がありません。')
  }
  const rawCollections = isPlainObject(raw.collections) ? raw.collections : {}
  const collections = {} as Record<TransferCollection, TransferDocs>
  for (const name of TRANSFER_COLLECTIONS) {
    const docs = rawCollections[name]
    if (docs === undefined) {
      collections[name] = {}
      continue
    }
    if (!isPlainObject(docs) || !Object.values(docs).every(isPlainObject)) {
      throw new Error(`ファイルの「${TRANSFER_COLLECTION_LABELS[name]}」の形式が正しくありません。`)
    }
    collections[name] = docs as TransferDocs
  }
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    sourceProjectId: typeof raw.sourceProjectId === 'string' ? raw.sourceProjectId : null,
    facility: {
      id: facility.id,
      name: facility.name,
      ...(typeof facility.shortName === 'string' && facility.shortName ? { shortName: facility.shortName } : {}),
    },
    collections,
  }
}

export interface ImportPlan {
  writes: { collection: TransferCollection; id: string; data: Record<string, unknown> }[]
  deletes: { collection: TransferCollection; id: string }[]
}

/**
 * 読み込み先に今ある文書IDの一覧と突き合わせて、書き込む文書・消す文書を決める。
 * ファイルにある文書は丸ごと上書き、ファイルに無い文書は削除（＝読み込み後はファイルと同じ状態になる）。
 */
export function planImport(
  file: FacilityTransferFile,
  existingIds: Partial<Record<TransferCollection, string[]>>,
): ImportPlan {
  const writes: ImportPlan['writes'] = []
  const deletes: ImportPlan['deletes'] = []
  for (const name of TRANSFER_COLLECTIONS) {
    const docs = file.collections[name]
    for (const [id, data] of Object.entries(docs)) writes.push({ collection: name, id, data: decodeDoc(data) })
    for (const id of existingIds[name] ?? []) {
      if (!(id in docs)) deletes.push({ collection: name, id })
    }
  }
  return { writes, deletes }
}

/** 画面表示用: コレクションごとの件数 */
export function countDocs(file: FacilityTransferFile): Record<TransferCollection, number> {
  return Object.fromEntries(
    TRANSFER_COLLECTIONS.map((name) => [name, Object.keys(file.collections[name]).length]),
  ) as Record<TransferCollection, number>
}
