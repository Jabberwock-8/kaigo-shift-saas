import { describe, expect, it } from 'vitest'
import { buildInvitedUserDoc } from './inviteAdmin'

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
