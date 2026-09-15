/**
 * Firestore への型付きアクセスをまとめる薄いレイヤー。
 * 画面(features)側は Firestore の生API(doc/collection)を直接触らず、ここを経由する。
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import { daysInMonth as daysInMonthOf } from './dateUtils'
import {
  mergeGenerationConfig,
  type GenerationConfig,
  type GenerationConfigOverride,
} from '../domain/scheduler/defaults'
import type { Candidate, GenerateInput } from '../domain/scheduler/types'
import type {
  AppUser,
  Compatibility,
  CompatibilityLevel,
  EmploymentType,
  Facility,
  JobType,
  LeaveRequest,
  Rule,
  Schedule,
  ShiftPattern,
  ShiftRulesSettings,
  Staff,
  TimeproExportSettings,
} from '../types/models'

function requireDb() {
  if (!db) {
    throw new Error(
      'Firestore が初期化されていません。.env.development / .env.production を確認してください。',
    )
  }
  return db
}

export async function fetchUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(requireDb(), 'users', uid))
  return snap.exists() ? (snap.data() as AppUser) : null
}

export async function fetchFacility(
  facilityId: string,
): Promise<(Facility & { id: string }) | null> {
  const snap = await getDoc(doc(requireDb(), 'facilities', facilityId))
  return snap.exists() ? { id: snap.id, ...(snap.data() as Facility) } : null
}

export async function fetchFacilities(
  facilityIds: string[],
): Promise<(Facility & { id: string })[]> {
  const results = await Promise.all(facilityIds.map((id) => fetchFacility(id)))
  return results.filter((f): f is Facility & { id: string } => f !== null)
}

// ------------------------------------------------------------------
// 施設のサブコレクションへの汎用アクセス
// ------------------------------------------------------------------

function subCollection(facilityId: string, name: string) {
  return collection(requireDb(), 'facilities', facilityId, name)
}

async function listSub<T>(
  facilityId: string,
  name: string,
  orderByField = 'order',
): Promise<(T & { id: string })[]> {
  const snap = await getDocs(query(subCollection(facilityId, name), orderBy(orderByField)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))
}

async function upsertSub<T extends object>(
  facilityId: string,
  name: string,
  id: string | null,
  data: T,
): Promise<string> {
  if (id) {
    await setDoc(doc(requireDb(), 'facilities', facilityId, name, id), data, {
      merge: true,
    })
    return id
  }
  const ref = await addDoc(subCollection(facilityId, name), data)
  return ref.id
}

async function deleteSub(facilityId: string, name: string, id: string) {
  await deleteDoc(doc(requireDb(), 'facilities', facilityId, name, id))
}

// ------------------------------------------------------------------
// staff
// ------------------------------------------------------------------

export async function fetchStaffList(
  facilityId: string,
): Promise<(Staff & { id: string })[]> {
  const snap = await getDocs(
    query(subCollection(facilityId, 'staff'), orderBy('name')),
  )
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Staff) }))
}

export async function fetchStaff(
  facilityId: string,
  staffId: string,
): Promise<(Staff & { id: string }) | null> {
  const snap = await getDoc(doc(requireDb(), 'facilities', facilityId, 'staff', staffId))
  return snap.exists() ? { id: snap.id, ...(snap.data() as Staff) } : null
}

export function upsertStaff(facilityId: string, id: string | null, data: Staff) {
  return upsertSub(facilityId, 'staff', id, data)
}

export function deleteStaff(facilityId: string, id: string) {
  return deleteSub(facilityId, 'staff', id)
}

// ------------------------------------------------------------------
// jobTypes
// ------------------------------------------------------------------

export function listJobTypes(facilityId: string) {
  return listSub<JobType>(facilityId, 'jobTypes')
}

export function upsertJobType(facilityId: string, id: string | null, data: JobType) {
  return upsertSub(facilityId, 'jobTypes', id, data)
}

export function deleteJobType(facilityId: string, id: string) {
  return deleteSub(facilityId, 'jobTypes', id)
}

// ------------------------------------------------------------------
// employmentTypes
// ------------------------------------------------------------------

export function listEmploymentTypes(facilityId: string) {
  return listSub<EmploymentType>(facilityId, 'employmentTypes')
}

export function upsertEmploymentType(
  facilityId: string,
  id: string | null,
  data: EmploymentType,
) {
  return upsertSub(facilityId, 'employmentTypes', id, data)
}

export function deleteEmploymentType(facilityId: string, id: string) {
  return deleteSub(facilityId, 'employmentTypes', id)
}

// ------------------------------------------------------------------
// shiftPatterns
// ------------------------------------------------------------------

export function listShiftPatterns(facilityId: string) {
  return listSub<ShiftPattern>(facilityId, 'shiftPatterns')
}

export function upsertShiftPattern(
  facilityId: string,
  id: string | null,
  data: ShiftPattern,
) {
  return upsertSub(facilityId, 'shiftPatterns', id, data)
}

export function deleteShiftPattern(facilityId: string, id: string) {
  return deleteSub(facilityId, 'shiftPatterns', id)
}

// ------------------------------------------------------------------
// compatibilities（相性。「普通」は保存しない）
// ------------------------------------------------------------------

/** 2つのstaffIdを昇順で連結してドキュメントIDにする */
function compatibilityId(a: string, b: string) {
  return [a, b].sort().join('__')
}

export async function listCompatibilities(
  facilityId: string,
): Promise<(Compatibility & { id: string })[]> {
  const col = collection(requireDb(), 'facilities', facilityId, 'compatibilities')
  const snap = await getDocs(col)
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Compatibility) }))
}

/** level が null（＝普通）なら削除、それ以外なら作成/上書き */
export async function setCompatibility(
  facilityId: string,
  staffIdA: string,
  staffIdB: string,
  level: CompatibilityLevel | null,
) {
  const ref = doc(
    requireDb(),
    'facilities',
    facilityId,
    'compatibilities',
    compatibilityId(staffIdA, staffIdB),
  )
  if (!level) {
    await deleteDoc(ref)
    return
  }
  const [a, b] = [staffIdA, staffIdB].sort()
  const data: Compatibility = { staffIdA: a, staffIdB: b, level }
  await setDoc(ref, data)
}

// ------------------------------------------------------------------
// rules（条件ビルダー）
// ------------------------------------------------------------------

export async function listRules(facilityId: string): Promise<(Rule & { id: string })[]> {
  const col = collection(requireDb(), 'facilities', facilityId, 'rules')
  const snap = await getDocs(col)
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Rule) }))
  // order が未設定のドキュメントもあり得るため、orderBy クエリではなくここで並べ替える
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function upsertRule(facilityId: string, id: string | null, data: Rule) {
  return upsertSub(facilityId, 'rules', id, data)
}

export async function setRuleEnabled(facilityId: string, id: string, enabled: boolean) {
  await updateDoc(doc(requireDb(), 'facilities', facilityId, 'rules', id), { enabled })
}

export function deleteRule(facilityId: string, id: string) {
  return deleteSub(facilityId, 'rules', id)
}

// ------------------------------------------------------------------
// schedules（月間シフト。Phase 3a では assignments / locks のみ使用）
// ------------------------------------------------------------------

function scheduleRef(facilityId: string, yearMonth: string) {
  return doc(requireDb(), 'facilities', facilityId, 'schedules', yearMonth)
}

export async function fetchSchedule(
  facilityId: string,
  yearMonth: string,
): Promise<Schedule | null> {
  const snap = await getDoc(scheduleRef(facilityId, yearMonth))
  return snap.exists() ? (snap.data() as Schedule) : null
}

/** ドキュメントが無ければ空のシフト表として作成する */
async function ensureSchedule(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  uid: string,
) {
  const ref = scheduleRef(facilityId, yearMonth)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      yearMonth,
      daysInMonth,
      status: 'draft',
      assignments: {},
      locks: {},
      revision: 1,
      createdByUid: uid,
      updatedByUid: uid,
      updatedAt: serverTimestamp(),
    })
  }
  return ref
}

export async function setAssignment(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  staffId: string,
  day: number,
  patternId: string | null,
  uid: string,
) {
  const ref = await ensureSchedule(facilityId, yearMonth, daysInMonth, uid)
  await updateDoc(ref, {
    [`assignments.${staffId}.${day}`]: patternId ?? deleteField(),
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
    revision: increment(1),
  })
}

export async function setLock(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  staffId: string,
  day: number,
  locked: boolean,
  uid: string,
) {
  const ref = await ensureSchedule(facilityId, yearMonth, daysInMonth, uid)
  await updateDoc(ref, {
    [`locks.${staffId}.${day}`]: locked ? true : deleteField(),
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
    revision: increment(1),
  })
}

/** その月のセルロックをすべて解除する（古いロックが原因で自動生成に不要な制約が残るのを防ぐための一括操作） */
export async function clearAllLocks(facilityId: string, yearMonth: string, daysInMonth: number, uid: string) {
  const ref = await ensureSchedule(facilityId, yearMonth, daysInMonth, uid)
  await updateDoc(ref, {
    locks: {},
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
    revision: increment(1),
  })
}

/** 行事・予定（日付→テキスト）を1日分だけ更新する。空文字なら削除する */
export async function setEvent(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  day: number,
  text: string,
  uid: string,
) {
  const ref = await ensureSchedule(facilityId, yearMonth, daysInMonth, uid)
  await updateDoc(ref, {
    [`events.${day}`]: text.trim() ? text.trim() : deleteField(),
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
    revision: increment(1),
  })
}

/** その月だけの勤務日数上限の上書き（P5）をまとめて保存する */
export async function saveMonthlyMaxDaysOverride(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  override: Record<string, { targetWorkdays?: number | null; maxWorkdays?: number | null }>,
  uid: string,
) {
  const ref = await ensureSchedule(facilityId, yearMonth, daysInMonth, uid)
  await updateDoc(ref, {
    monthlyMaxDaysOverride: override,
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
    revision: increment(1),
  })
}

// ------------------------------------------------------------------
// leaveRequests（希望休。Phase 3b時点では admin が代理入力する運用）
// ------------------------------------------------------------------

/** ドキュメントIDは「職員ID_日付」に固定し、1人1日1件を保証する */
function leaveRequestId(staffId: string, date: string) {
  return `${staffId}_${date}`
}

export async function fetchLeaveRequestsForMonth(
  facilityId: string,
  yearMonth: string,
): Promise<(LeaveRequest & { id: string })[]> {
  const col = collection(requireDb(), 'facilities', facilityId, 'leaveRequests')
  const snap = await getDocs(query(col, where('yearMonth', '==', yearMonth)))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as LeaveRequest) }))
}

/** 希望休を立てる（既にあれば何もしない） */
export async function setWish(
  facilityId: string,
  staffId: string,
  date: string,
  yearMonth: string,
  uid: string,
) {
  const ref = doc(
    requireDb(),
    'facilities',
    facilityId,
    'leaveRequests',
    leaveRequestId(staffId, date),
  )
  const data: LeaveRequest = {
    staffId,
    yearMonth,
    date,
    type: '希望休',
    desiredPatternId: null,
    priority: 'must',
    status: 'approved',
    createdByUid: uid,
  }
  await setDoc(ref, data)
}

/** 希望休を取り消す */
export async function clearWish(facilityId: string, staffId: string, date: string) {
  const ref = doc(
    requireDb(),
    'facilities',
    facilityId,
    'leaveRequests',
    leaveRequestId(staffId, date),
  )
  await deleteDoc(ref)
}

// ------------------------------------------------------------------
// settings/shiftRules（未作成 = 全て制約なしとして扱う）
// ------------------------------------------------------------------

export const DEFAULT_SHIFT_RULES_SETTINGS: ShiftRulesSettings = {
  nightMode: null,
  nightAvoidPatternIdsAfter2: [],
  shiftConsecutiveCaps: {},
  minRestHours: null,
  preferredFillTimeRange: { start: null, end: null },
  treatCompatibilityXAsHard: null,
  treatRestHoursAsHard: null,
  maxConsecutiveWorkdaysDefault: null,
  monthlyLimitsDefault: { targetWorkdays: null, maxWorkdays: null, maxNightShifts: null },
}

function shiftRulesRef(facilityId: string) {
  return doc(requireDb(), 'facilities', facilityId, 'settings', 'shiftRules')
}

export async function fetchShiftRulesSettings(facilityId: string): Promise<ShiftRulesSettings> {
  const snap = await getDoc(shiftRulesRef(facilityId))
  if (!snap.exists()) return { ...DEFAULT_SHIFT_RULES_SETTINGS }
  const data = snap.data() as Partial<ShiftRulesSettings>
  return {
    ...DEFAULT_SHIFT_RULES_SETTINGS,
    ...data,
    preferredFillTimeRange: {
      ...DEFAULT_SHIFT_RULES_SETTINGS.preferredFillTimeRange,
      ...data.preferredFillTimeRange,
    },
    monthlyLimitsDefault: {
      ...DEFAULT_SHIFT_RULES_SETTINGS.monthlyLimitsDefault,
      ...data.monthlyLimitsDefault,
    },
  }
}

export async function saveShiftRulesSettings(facilityId: string, data: ShiftRulesSettings) {
  await setDoc(shiftRulesRef(facilityId), data, { merge: true })
}

// ------------------------------------------------------------------
// settings/timeproExport（未作成 = patternMap 空。既定値は buildTimeproRows.ts 側で生成）
// ------------------------------------------------------------------

function timeproExportRef(facilityId: string) {
  return doc(requireDb(), 'facilities', facilityId, 'settings', 'timeproExport')
}

export async function fetchTimeproExportSettings(facilityId: string): Promise<TimeproExportSettings> {
  const snap = await getDoc(timeproExportRef(facilityId))
  if (!snap.exists()) return { patternMap: {} }
  const data = snap.data() as Partial<TimeproExportSettings>
  return { patternMap: data.patternMap ?? {} }
}

export async function saveTimeproExportSettings(facilityId: string, data: TimeproExportSettings) {
  await setDoc(timeproExportRef(facilityId), data, { merge: true })
}

// ------------------------------------------------------------------
// settings/generationConfig（未作成なら defaults.ts の既定値を使う）
// ------------------------------------------------------------------

function generationConfigRef(facilityId: string) {
  return doc(requireDb(), 'facilities', facilityId, 'settings', 'generationConfig')
}

/** 既定値にフィールド単位でマージ済みの生成設定を返す（施設ごとに未作成なら既定値そのもの） */
export async function fetchCurrentGenerationConfig(facilityId: string): Promise<GenerationConfig> {
  const snap = await getDoc(generationConfigRef(facilityId))
  const override = snap.exists() ? (snap.data() as GenerationConfigOverride) : null
  return mergeGenerationConfig(override)
}

// ------------------------------------------------------------------
// 自動生成（Phase 4e）: 入力の組み立て・候補の保存・採択
// ------------------------------------------------------------------

/** 自動生成エンジンへ渡す入力一式を、既存フェッチャの Promise.all で組み立てる */
export async function loadGenerateInput(facilityId: string, yearMonth: string): Promise<GenerateInput> {
  const days = daysInMonthOf(yearMonth)
  const [staffAll, employmentTypes, shiftPatterns, rulesAll, compatibilities, settings, wishesAll, schedule, config] =
    await Promise.all([
      fetchStaffList(facilityId),
      listEmploymentTypes(facilityId),
      listShiftPatterns(facilityId),
      listRules(facilityId),
      listCompatibilities(facilityId),
      fetchShiftRulesSettings(facilityId),
      fetchLeaveRequestsForMonth(facilityId, yearMonth),
      fetchSchedule(facilityId, yearMonth),
      fetchCurrentGenerationConfig(facilityId),
    ])

  return {
    yearMonth,
    daysInMonth: days,
    staff: staffAll.filter((s) => s.active !== false),
    employmentTypes,
    shiftPatterns,
    rules: rulesAll.filter((r) => r.enabled),
    compatibilities,
    settings,
    wishes: wishesAll
      .filter((w) => w.type === '希望休')
      .map((w) => ({ staffId: w.staffId, day: Number(w.date.split('-')[2]) })),
    lockedCells: (schedule?.locks ?? {}) as Record<string, Record<string, true>>,
    baseAssignments: schedule?.assignments ?? {},
    monthlyMaxDaysOverride: schedule?.monthlyMaxDaysOverride,
    config,
  }
}

function candidatesCollection(facilityId: string, yearMonth: string) {
  return collection(requireDb(), 'facilities', facilityId, 'schedules', yearMonth, 'candidates')
}

export async function listCandidates(
  facilityId: string,
  yearMonth: string,
): Promise<(Candidate & { id: string })[]> {
  const snap = await getDocs(candidatesCollection(facilityId, yearMonth))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Candidate) }))
}

export async function clearCandidates(facilityId: string, yearMonth: string) {
  const snap = await getDocs(candidatesCollection(facilityId, yearMonth))
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
}

/** 既存の候補（あれば）を削除してから、生成された3案を保存する */
export async function saveCandidates(
  facilityId: string,
  yearMonth: string,
  candidates: Candidate[],
): Promise<(Candidate & { id: string })[]> {
  const col = candidatesCollection(facilityId, yearMonth)
  await clearCandidates(facilityId, yearMonth)
  return Promise.all(
    candidates.map(async (c) => {
      const ref = await addDoc(col, { ...c, generatedAt: serverTimestamp() })
      return { ...c, id: ref.id }
    }),
  )
}

/** 案を確定シフトとして採択する。assignments を全置換し、候補は削除する */
export async function adoptCandidate(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  candidate: Candidate,
  candidateId: string,
  uid: string,
  configSnapshot: GenerationConfig,
) {
  const ref = await ensureSchedule(facilityId, yearMonth, daysInMonth, uid)
  await updateDoc(ref, {
    assignments: candidate.assignments,
    generationMeta: {
      source: 'auto',
      candidateId,
      generationConfigSnapshot: configSnapshot,
      generatedAt: serverTimestamp(),
    },
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
    revision: increment(1),
  })
  await clearCandidates(facilityId, yearMonth)
}
