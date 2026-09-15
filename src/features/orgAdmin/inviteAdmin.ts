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

export async function inviteAdminUser(input: InviteAdminInput): Promise<void> {
  if (!db) throw new Error('Firestore が初期化されていません。')

  const secondaryApp = initializeApp(firebaseConfig, `invite-${crypto.randomUUID()}`)
  const secondaryAuth = getAuth(secondaryApp)
  try {
    let uid: string
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, input.email, randomTempPassword())
      uid = cred.user.uid
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'auth/email-already-in-use') {
        throw new Error(
          'このメールアドレスは既に登録されています。既存ユーザーは下の一覧から所属施設を編集してください。',
        )
      }
      throw e
    }

    await sendPasswordResetEmail(secondaryAuth, input.email)
    await signOut(secondaryAuth)

    const userDoc: AppUser = {
      email: input.email,
      displayName: input.displayName || undefined,
      organizationId: input.organizationId,
      facilityIds: input.facilityIds,
      primaryFacilityId: input.primaryFacilityId,
      role: 'admin',
      linkedStaffId: null,
    }
    await setDoc(doc(db, 'users', uid), userDoc)
  } finally {
    await deleteApp(secondaryApp)
  }
}
