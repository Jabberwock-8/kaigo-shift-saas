import { describe, expect, it } from 'vitest'
import { buildInvitedUserDoc, findExistingUser, removedUserPatch } from './inviteAdmin'

const base = {
  email: 'new-admin@example.com',
  organizationId: 'org_wakokai',
  facilityIds: ['fac1'],
  primaryFacilityId: 'fac1',
}

/** Firestore は undefined の値を含む書き込みを拒否する。入れ子も含めて undefined が無いか調べる */
function hasUndefined(v: unknown): boolean {
  if (v === undefined) return true
  if (Array.isArray(v)) return v.some(hasUndefined)
  if (v && typeof v === 'object') return Object.values(v).some(hasUndefined)
  return false
}

describe('buildInvitedUserDoc', () => {
  it('表示名が空でも、Firestore が拒否する undefined の項目を含めない', () => {
    const d = buildInvitedUserDoc({ ...base, displayName: undefined })
    expect(hasUndefined(d)).toBe(false)
    expect(d).not.toHaveProperty('displayName')
  })

  it('表示名があれば入れる。役割は常に管理者', () => {
    const d = buildInvitedUserDoc({ ...base, displayName: 'アミティホーム寺田代表' })
    expect(d.displayName).toBe('アミティホーム寺田代表')
    expect(d.role).toBe('admin')
    expect(d.linkedStaffId).toBeNull()
  })
})

describe('findExistingUser', () => {
  const users = [
    { id: 'u1', email: 'Active@Example.com', role: 'admin' as const },
    { id: 'u2', email: 'gone@example.com', role: 'removed' as const },
  ]

  it('大文字小文字・前後の空白を無視して、有効な管理者を見つける', () => {
    expect(findExistingUser(users, '  active@example.COM ')).toEqual({ kind: 'active', user: users[0] })
  })

  it('削除済みの管理者は removed として返す（招待し直しで元に戻すため）', () => {
    expect(findExistingUser(users, 'gone@example.com')).toEqual({ kind: 'removed', user: users[1] })
  })

  it('いなければ null', () => {
    expect(findExistingUser(users, 'new@example.com')).toBeNull()
  })
})

describe('removedUserPatch', () => {
  it('権限と所属施設を外す（firestore.rules は admin にしか権限を与えない）', () => {
    const p = removedUserPatch()
    expect(p.role).not.toBe('admin')
    expect(p.facilityIds).toEqual([])
    expect(p.primaryFacilityId).toBeNull()
  })
})
