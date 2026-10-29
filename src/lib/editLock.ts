/**
 * 勤務表の編集ロック（月ごと）のパスワード処理。docs/remaining-work-design.md §17 参照。
 * パスワードはそのまま保存せず、ソルト付きの PBKDF2 で変換した値だけを保存する。
 * 目的はうっかり変更の防止で、Firestore を直接操作できる人は止められない（ルールでは確かめない）。
 */

const ITERATIONS = 100_000

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function newEditLockSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

export async function hashEditLockPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITERATIONS },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

export async function verifyEditLockPassword(password: string, lock: { hash: string; salt: string }): Promise<boolean> {
  return (await hashEditLockPassword(password, lock.salt)) === lock.hash
}

/** パスワードの最低文字数（4文字。数字だけでもよい） */
export const EDIT_LOCK_MIN_LENGTH = 4
