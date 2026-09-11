/**
 * Firestore への型付きアクセスをまとめる薄いレイヤー。
 * 画面(features)側は Firestore の生API(doc/collection)を直接触らず、ここを経由する。
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from './firebase'
import type { AppUser, Facility, Staff } from '../types/models'

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

export async function fetchStaffList(
  facilityId: string,
): Promise<(Staff & { id: string })[]> {
  const col = collection(requireDb(), 'facilities', facilityId, 'staff')
  const snap = await getDocs(query(col, orderBy('name')))
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Staff) }))
}
