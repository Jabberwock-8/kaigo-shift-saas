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
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'
import { daysInMonth as daysInMonthOf, shiftYearMonth } from './dateUtils'
import { prevMonthTail } from '../domain/scheduler/gridUtils'
import {
  mergeGenerationConfig,
  type GenerationConfig,
  type GenerationConfigOverride,
} from '../domain/scheduler/defaults'
import type { Candidate, GenerateInput } from '../domain/scheduler/types'
import type {
  AppUser,
  SubmissionSettings,
  Compatibility,
  CompatibilityLevel,
  EmploymentType,
  Facility,
  JobType,
  LeaveRequest,
  PaidLeaveInfo,
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
// 施設・ユーザー管理（横展開）。org-admin機能。role='admin'のみアクセス可（firestore.rules参照）
// ------------------------------------------------------------------

/** 自分がまだ所属していない施設も含め、組織内の全施設を返す（施設・ユーザー管理画面用） */
export async function fetchOrganizationFacilities(
  organizationId: string,
): Promise<(Facility & { id: string })[]> {
  const snap = await getDocs(
    query(collection(requireDb(), 'facilities'), where('organizationId', '==', organizationId)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Facility) }))
}

export async function createFacility(
  organizationId: string,
  data: { name: string; shortName?: string },
): Promise<string> {
  const ref = await addDoc(collection(requireDb(), 'facilities'), { ...data, organizationId })
  return ref.id
}

export async function updateFacility(
  facilityId: string,
  patch: Partial<Pick<Facility, 'name' | 'shortName' | 'serviceType' | 'officeName'>>,
) {
  // Firestore は undefined の項目を含む書き込みを拒否するため、未入力の項目は消す（deleteField）
  const data = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined || v === '' ? deleteField() : v]))
  await updateDoc(doc(requireDb(), 'facilities', facilityId), data)
}

export async function fetchOrganizationUsers(
  organizationId: string,
): Promise<(AppUser & { id: string })[]> {
  const snap = await getDocs(
    query(collection(requireDb(), 'users'), where('organizationId', '==', organizationId)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as AppUser) }))
}

/** 招待済みユーザーの所属施設・主施設・表示名を更新する（組織を跨いだ付け替えは firestore.rules で禁止） */
export async function updateOrgUser(
  uid: string,
  patch: Partial<Pick<AppUser, 'facilityIds' | 'primaryFacilityId' | 'displayName'>>,
) {
  await updateDoc(doc(requireDb(), 'users', uid), patch)
}

// ------------------------------------------------------------------
// 施設のサブコレクションへの汎用アクセス
// ------------------------------------------------------------------

function subCollection(facilityId: string, name: string) {
  return collection(requireDb(), 'facilities', facilityId, name)
}

async function listSub<T extends { order?: number }>(
  facilityId: string,
  name: string,
): Promise<(T & { id: string })[]> {
  // orderBy('order') は order 未設定のドキュメントを結果から黙って除外する（CLAUDE.md の注意事項）。
  // 勤務パターンが1件でも消えると自動生成の入力からも消えるため、取得後にJS側で並べ替える
  const snap = await getDocs(subCollection(facilityId, name))
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
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
  // order 未設定のドキュメントが除外されてしまうため orderBy クエリは使わず、取得後にJS側で並べ替える
  const snap = await getDocs(subCollection(facilityId, 'staff'))
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Staff) }))
  return rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'ja'))
}

/** 職員カードの並び順だけを更新する。merge なので他のフィールドには触れない */
export async function updateStaffOrder(facilityId: string, id: string, order: number) {
  await setDoc(doc(requireDb(), 'facilities', facilityId, 'staff', id), { order }, { merge: true })
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

/** 有給休暇の残日数設定（付与月・付与日数・基準年月・基準残日数）だけを部分更新する */
export async function updateStaffPaidLeave(
  facilityId: string,
  staffId: string,
  patch: PaidLeaveInfo,
) {
  await updateDoc(doc(requireDb(), 'facilities', facilityId, 'staff', staffId), { paidLeave: patch })
}

/** 複数月分の schedules をまとめて取得する（有給残日数ページで消化日数を積算するために使う） */
export async function fetchSchedulesForMonths(
  facilityId: string,
  yearMonths: string[],
): Promise<Record<string, Schedule | null>> {
  const entries = await Promise.all(
    yearMonths.map(async (ym) => [ym, await fetchSchedule(facilityId, ym)] as const),
  )
  return Object.fromEntries(entries)
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
  // 2人が同時に最初の入力をしても、後の人が先の人の入力を空の表で上書きしないよう、無いときだけ作る
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) tx.set(ref, newScheduleData(yearMonth, daysInMonth, uid))
  })
  return ref
}

function newScheduleData(yearMonth: string, daysInMonth: number, uid: string) {
  return {
    yearMonth,
    daysInMonth,
    status: 'draft',
    assignments: {},
    locks: {},
    revision: 1,
    createdByUid: uid,
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
  }
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

/** 生活相談員などの兼務行（secondaryAssignments）を1セル更新する。assignmentsとは独立 */
export async function setSecondaryAssignment(
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
    [`secondaryAssignments.${staffId}.${day}`]: patternId ?? deleteField(),
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
  // 既にある申請（有給希望など、別の種類を含む）は上書きしない
  await runTransaction(requireDb(), async (tx) => {
    if (!(await tx.get(ref)).exists()) tx.set(ref, data)
  })
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
  // 希望休だけを消す（同じ日の有給希望・勤務希望は消さない）
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(ref)
    if (snap.exists() && (snap.data() as LeaveRequest).type === '希望休') tx.delete(ref)
  })
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
  monthlyLimitsDefault: { targetWorkdays: null, maxWorkdays: null, maxNightShifts: null, offDaysPerMonth: null },
  maxWishesPerMonth: null,
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

// ------------------------------------------------------------------
// settings/submission（市の提出様式の出力設定。未作成なら既定値）
// ------------------------------------------------------------------

export const DEFAULT_SUBMISSION_SETTINGS: SubmissionSettings = { hoursPerWeek: 40, hoursPerMonth: null, period: '暦月' }

function submissionRef(facilityId: string) {
  return doc(requireDb(), 'facilities', facilityId, 'settings', 'submission')
}

export async function fetchSubmissionSettings(facilityId: string): Promise<SubmissionSettings> {
  const snap = await getDoc(submissionRef(facilityId))
  return { ...DEFAULT_SUBMISSION_SETTINGS, ...(snap.exists() ? (snap.data() as Partial<SubmissionSettings>) : {}) }
}

export async function saveSubmissionSettings(facilityId: string, data: SubmissionSettings) {
  await setDoc(submissionRef(facilityId), data, { merge: true })
}

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
  // 月をまたぐ夜勤明け・連続勤務のため、前月末の勤務を渡す（前月の勤務表が無ければ渡さない）
  const prevYm = shiftYearMonth(yearMonth, -1)
  const prevSchedule = await fetchSchedule(facilityId, prevYm)

  return {
    yearMonth,
    daysInMonth: days,
    // シフト作成の対象外の職員（施設長・看護師など）は生成に含めない。勤務は手で入れたものを採択時に残す
    staff: staffAll.filter((s) => s.active !== false && !s.excludeFromGeneration),
    employmentTypes,
    shiftPatterns,
    rules: rulesAll.filter((r) => r.enabled),
    compatibilities,
    settings,
    wishes: wishesAll
      // 生成で必ず守るのは、却下されておらず、承認済みか「必ず」の希望休だけ
      .filter((w) => w.type === '希望休' && w.status !== 'rejected' && (w.status === 'approved' || w.priority === 'must'))
      .map((w) => ({ staffId: w.staffId, day: Number(w.date.split('-')[2]) })),
    lockedCells: (schedule?.locks ?? {}) as Record<string, Record<string, true>>,
    baseAssignments: schedule?.assignments ?? {},
    monthlyMaxDaysOverride: schedule?.monthlyMaxDaysOverride,
    prevTail: prevSchedule ? prevMonthTail(prevSchedule.assignments, daysInMonthOf(prevYm)) : undefined,
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
  const batch = writeBatch(requireDb())
  snap.docs.forEach((d) => batch.delete(d.ref))
  await batch.commit()
}

/** 既存の候補（あれば）を削除してから、生成された3案を保存する */
export async function saveCandidates(
  facilityId: string,
  yearMonth: string,
  candidates: Candidate[],
): Promise<(Candidate & { id: string })[]> {
  const col = candidatesCollection(facilityId, yearMonth)
  const old = await getDocs(col)
  // 古い案の削除と新しい案の保存を一度に行う（途中で失敗しても、古い案と新しい案が混ざらない）
  const batch = writeBatch(requireDb())
  old.docs.forEach((d) => batch.delete(d.ref))
  const saved = candidates.map((c) => {
    const ref = doc(col)
    batch.set(ref, { ...c, generatedAt: serverTimestamp() })
    return { ...c, id: ref.id }
  })
  await batch.commit()
  return saved
}

/** 案を作ったあとに勤務表が変更されていたとき、採択で投げる（画面で確認してから force で採択し直す） */
export class ScheduleChangedError extends Error {
  constructor() {
    super('案を作ったあとに、この月の勤務表が変更されています')
    this.name = 'ScheduleChangedError'
  }
}

/**
 * 案を確定シフトとして採択する。assignments を全置換し、候補は削除する。
 * 案を作ったあとに勤務表が変更されていたら（版が違えば）ScheduleChangedError。force なら構わず採択する
 */
export async function adoptCandidate(
  facilityId: string,
  yearMonth: string,
  daysInMonth: number,
  candidate: Candidate,
  candidateId: string,
  uid: string,
  configSnapshot: GenerationConfig,
  force = false,
) {
  const ref = scheduleRef(facilityId, yearMonth)
  // baseRevision は保存しない（勤務表の項目ではないため）
  const { baseRevision, ...rest } = candidate
  const update = {
    assignments: rest.assignments,
    generationMeta: {
      source: 'auto',
      candidateId,
      generationConfigSnapshot: configSnapshot,
      generatedAt: serverTimestamp(),
    },
    updatedByUid: uid,
    updatedAt: serverTimestamp(),
  }
  await runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.exists() ? ((snap.data() as Schedule).revision ?? 0) : 0
    // 版を持たない古い案（この仕組みより前に作った案）は確かめられないので、そのまま採択する
    if (!force && baseRevision != null && current !== baseRevision) throw new ScheduleChangedError()
    if (snap.exists()) tx.update(ref, { ...update, revision: increment(1) })
    else tx.set(ref, { ...newScheduleData(yearMonth, daysInMonth, uid), ...update })
  })
  await clearCandidates(facilityId, yearMonth)
}
