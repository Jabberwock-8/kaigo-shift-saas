/**
 * Firestore への型付きアクセスをまとめる薄いレイヤー。
 * 画面(features)側は Firestore の生API(doc/collection)を直接触らず、ここを経由する。
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  AppUser,
  EmploymentType,
  Facility,
  JobType,
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
