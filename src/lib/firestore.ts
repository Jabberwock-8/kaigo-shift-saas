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
import type {
  AppUser,
  EmploymentType,
  Facility,
  JobType,
  LeaveRequest,
  Schedule,
  ShiftPattern,
  Staff,
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
