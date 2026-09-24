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
import { doc, setDoc } from 'firebase/firestore'
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

export async function inviteAdminUser(input: InviteAdminInput): Promise<void> {
  if (!db) throw new Error('Firestore が初期化されていません。')

  const secondaryApp = initializeApp(firebaseConfig, `invite-${crypto.randomUUID()}`)
  const secondaryAuth = getAuth(secondaryApp)
  try {
    let cred
    try {
      cred = await createUserWithEmailAndPassword(secondaryAuth, input.email, randomTempPassword())
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'auth/email-already-in-use') {
        throw new Error(
          'このメールアドレスは既に登録されています。既存ユーザーは下の一覧から所属施設を編集してください。',
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
