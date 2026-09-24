/**
 * 施設データの引っ越し（dev → prod）の Firestore 読み書き。docs/remaining-work-design.md §12 参照。
 * ファイル形式・変換・検証は facilityTransferCodec.ts（純関数）側。
 */
import { FirebaseError } from 'firebase/app'
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db, firebaseStatus } from './firebase'
import {
  TRANSFER_COLLECTIONS,
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  encodeDoc,
  planImport,
  type FacilityTransferFile,
  type TransferCollection,
  type TransferDocs,
} from './facilityTransferCodec'
import type { AppUser, Facility } from '../types/models'

/** 1回の一括書き込みに入れる件数（Firestore の上限500件より余裕を持たせる） */
const BATCH_SIZE = 200

function requireDb() {
  if (!db) throw new Error('Firestore が初期化されていません。')
  return db
}

function isPermissionDenied(e: unknown) {
  return e instanceof FirebaseError && e.code === 'permission-denied'
}

/** 施設1つ分のデータを、ファイルに書き出せる形でまとめる */
export async function exportFacilityData(facilityId: string): Promise<FacilityTransferFile> {
  const fdb = requireDb()
  const facilitySnap = await getDoc(doc(fdb, 'facilities', facilityId))
  if (!facilitySnap.exists()) throw new Error('施設が見つかりません。')
  const facility = facilitySnap.data() as Facility

  const collections = {} as Record<TransferCollection, TransferDocs>
  for (const name of TRANSFER_COLLECTIONS) {
    const snap = await getDocs(collection(fdb, 'facilities', facilityId, name))
    collections[name] = Object.fromEntries(snap.docs.map((d) => [d.id, encodeDoc(d.data())]))
  }

  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    sourceProjectId: firebaseStatus.projectId,
    facility: {
      id: facilityId,
      name: facility.name,
      ...(facility.shortName ? { shortName: facility.shortName } : {}),
    },
    collections,
  }
}

export interface ImportTarget {
  /** 読み込み先の環境に同じIDの施設がすでにあるか */
  exists: boolean
  /** すでにある場合の今の施設名 */
  currentName: string | null
}

/**
 * 読み込み先の環境に同じ施設がすでにあるかを調べる（確認画面の警告用）。
 * 施設がまだ無いとき、firestore.rules は読み取り自体を拒否する（照合先の organizationId が無いため）ので、
 * 拒否は「まだ無い」として扱う。
 */
export async function inspectImportTarget(facilityId: string): Promise<ImportTarget> {
  try {
    const snap = await getDoc(doc(requireDb(), 'facilities', facilityId))
    if (!snap.exists()) return { exists: false, currentName: null }
    return { exists: true, currentName: (snap.data() as Facility).name }
  } catch (e) {
    if (isPermissionDenied(e)) return { exists: false, currentName: null }
    throw e
  }
}

export interface ImportResult {
  written: number
  deleted: number
}

/**
 * ファイルの内容で施設を作成（または置き換え）する。
 * 読み込み後は、その施設のサブコレクションがファイルと同じ状態になる（ファイルに無い文書は削除）。
 * 途中で失敗しても、もう一度読み込めば正しい状態になる。
 */
export async function importFacilityData(
  file: FacilityTransferFile,
  me: { uid: string; user: AppUser },
  onProgress?: (message: string) => void,
): Promise<ImportResult> {
  const fdb = requireDb()
  const facilityId = file.facility.id
  const facilityRef = doc(fdb, 'facilities', facilityId)

  // 1. 施設本体。組織は読み込む人の組織に置き換える（環境ごとに組織IDが違ってよいように）
  onProgress?.('施設を作成しています…')
  try {
    await setDoc(
      facilityRef,
      {
        organizationId: me.user.organizationId,
        name: file.facility.name,
        ...(file.facility.shortName ? { shortName: file.facility.shortName } : {}),
      },
      { merge: true },
    )
  } catch (e) {
    if (isPermissionDenied(e)) {
      throw new Error('施設を作成できませんでした。この環境の管理者アカウントでログインしているか確認してください。')
    }
    throw e
  }

  // 2. 自分の所属施設に加える。firestore.rules は所属施設にしか書き込みを許さないため、中身より先に行う
  if (!(me.user.facilityIds ?? []).includes(facilityId)) {
    onProgress?.('所属施設に追加しています…')
    await updateDoc(doc(fdb, 'users', me.uid), {
      facilityIds: arrayUnion(facilityId),
      ...(me.user.primaryFacilityId ? {} : { primaryFacilityId: facilityId }),
    })
  }

  // 3. 今ある文書の一覧を取り、書き込む文書・消す文書を決める
  onProgress?.('今のデータを確認しています…')
  const existingIds: Partial<Record<TransferCollection, string[]>> = {}
  for (const name of TRANSFER_COLLECTIONS) {
    const snap = await getDocs(collection(fdb, 'facilities', facilityId, name))
    existingIds[name] = snap.docs.map((d) => d.id)
  }
  const plan = planImport(file, existingIds)

  // 4. 200件ずつ一括で書き込む（ファイルにある文書は merge せず丸ごと置き換える）
  const ops = [
    ...plan.writes.map((w) => ({ kind: 'write' as const, ...w })),
    ...plan.deletes.map((d) => ({ kind: 'delete' as const, ...d })),
  ]
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    onProgress?.(`書き込んでいます…（${Math.min(i + BATCH_SIZE, ops.length)} / ${ops.length}件）`)
    const batch = writeBatch(fdb)
    for (const op of ops.slice(i, i + BATCH_SIZE)) {
      const ref = doc(fdb, 'facilities', facilityId, op.collection, op.id)
      if (op.kind === 'write') batch.set(ref, op.data)
      else batch.delete(ref)
    }
    await batch.commit()
  }

  return { written: plan.writes.length, deleted: plan.deletes.length }
}
