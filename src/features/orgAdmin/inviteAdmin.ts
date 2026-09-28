/**
 * 管理者アカウントの招待（施設・ユーザー管理画面）。
 *
 * Firebase Authentication で他人のアカウントを作る通常の方法（Admin SDK / Cloud Functions）は
 * Blaze プランが前提になり、本プロジェクトの Spark 運用方針（docs/environment-strategy.md）と
 * 合わない。そこで、招待実行中だけ使い捨てのセカンダリ Firebase App でユーザーを作成し、
 * 招待した管理者自身のログインセッション（プライマリの auth）には触れないようにする。
 * パスワードは仮のランダム値を設定するだけで捨て、本人にはパスワード再設定メールを送る。
 */
import { deleteApp, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { db, firebaseConfig } from '../../lib/firebase'
import type { AppUser } from '../../types/models'

export interface InviteAdminInput {
  email: string
  displayName?: string
  organizationId: string
  facilityIds: string[]
  primaryFacilityId: string | null
}

function randomTempPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID()
}

/**
 * 招待する管理者の users ドキュメントの中身。
 * Firestore は値が undefined の項目を含む書き込みを拒否するため、表示名が空なら項目ごと入れない
 * （以前は undefined のまま書き込み、表示名を空欄で招待すると必ず失敗していた）。
 */
export function buildInvitedUserDoc(input: InviteAdminInput): AppUser {
  return {
    email: input.email,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    organizationId: input.organizationId,
    facilityIds: input.facilityIds,
    primaryFacilityId: input.primaryFacilityId,
    role: 'admin',
    linkedStaffId: null,
  }
}

/**
 * 招待しようとしているメールアドレスが、すでに組織の users にあるか（大文字小文字・前後の空白は無視）。
 * 削除済み（removed）なら招待し直しで元に戻せる。有効な管理者なら招待ではなく一覧の再送を使う
 */
export function findExistingUser<T extends Pick<AppUser, 'email' | 'role'>>(
  users: T[],
  email: string,
): { kind: 'active' | 'removed'; user: T } | null {
  const key = email.trim().toLowerCase()
  const user = users.find((u) => (u.email ?? '').trim().toLowerCase() === key)
  if (!user) return null
  return { kind: user.role === 'removed' ? 'removed' : 'active', user }
}

/** 削除時に users へ書き込む内容。権限と所属施設を外す（ドキュメントは残す） */
export function removedUserPatch(): Pick<AppUser, 'role' | 'facilityIds' | 'primaryFacilityId'> {
  return { role: 'removed', facilityIds: [], primaryFacilityId: null }
}

/** 使い捨てのセカンダリ App からパスワード再設定メールを日本語で送る（管理者自身のログインには触れない） */
async function sendSetupEmail(email: string) {
  const app = initializeApp(firebaseConfig, `resend-${crypto.randomUUID()}`)
  try {
    const auth = getAuth(app)
    auth.languageCode = 'ja'
    await sendPasswordResetEmail(auth, email)
  } finally {
    await deleteApp(app)
  }
}

/**
 * 招待メール（パスワード設定メール）を送り直す。メールのリンクには期限があるため、
 * 期限内に設定できなかった人やパスワードを忘れた人に使う
 */
export async function resendInviteEmail(email: string): Promise<void> {
  await sendSetupEmail(email)
}

/** 管理者を削除する（権限と所属施設を外す）。ログイン用アカウントは残るが、データには一切触れられなくなる */
export async function removeAdminUser(uid: string): Promise<void> {
  if (!db) throw new Error('Firestore が初期化されていません。')
  await updateDoc(doc(db, 'users', uid), removedUserPatch())
}

/** 削除済みの管理者を招待し直す。ログイン用アカウントは残っているので、users を管理者に戻してメールを送る */
export async function reactivateAdminUser(uid: string, input: InviteAdminInput): Promise<void> {
  if (!db) throw new Error('Firestore が初期化されていません。')
  await setDoc(doc(db, 'users', uid), buildInvitedUserDoc(input))
  await sendSetupEmail(input.email)
}

export async function inviteAdminUser(input: InviteAdminInput): Promise<void> {
  if (!db) throw new Error('Firestore が初期化されていません。')

  const secondaryApp = initializeApp(firebaseConfig, `invite-${crypto.randomUUID()}`)
  const secondaryAuth = getAuth(secondaryApp)
  // パスワード再設定メールを日本語で送る（未指定だと Firebase の既定の英語テンプレートになる）
  secondaryAuth.languageCode = 'ja'
  try {
    let cred
    try {
      cred = await createUserWithEmailAndPassword(secondaryAuth, input.email, randomTempPassword())
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'auth/email-already-in-use') {
        throw new Error(
          'このメールアドレスはログイン用アカウントが既にありますが、管理者の一覧にはありません。以前の招待が途中で失敗した可能性があります。Firebase コンソールでの対応が必要なので、開発担当に連絡してください。',
        )
      }
      throw e
    }

    // 管理者としての登録を先に行い、失敗したら作ったアカウントを消す。消さないと、同じメールアドレスで
    // 招待し直しても「既に登録されています」になり、画面からは二度と登録できなくなるため
    try {
      await setDoc(doc(db, 'users', cred.user.uid), buildInvitedUserDoc(input))
    } catch (e) {
      await deleteUser(cred.user).catch(() => {})
      throw e
    }

    await sendPasswordResetEmail(secondaryAuth, input.email)
    await signOut(secondaryAuth)
  } finally {
    await deleteApp(secondaryApp)
  }
}
