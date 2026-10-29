import { describe, expect, it } from 'vitest'
import { hashEditLockPassword, newEditLockSalt, verifyEditLockPassword } from './editLock'

describe('勤務表の編集ロックのパスワード', () => {
  it('同じパスワードなら一致し、違えば一致しない', async () => {
    const salt = newEditLockSalt()
    const lock = { salt, hash: await hashEditLockPassword('1234', salt) }
    expect(await verifyEditLockPassword('1234', lock)).toBe(true)
    expect(await verifyEditLockPassword('1235', lock)).toBe(false)
  })

  it('パスワードそのものは保存する値に含まれず、ソルトが違えば別の値になる', async () => {
    const a = await hashEditLockPassword('pass', newEditLockSalt())
    const b = await hashEditLockPassword('pass', newEditLockSalt())
    expect(a).not.toContain('pass')
    expect(a).not.toBe(b)
  })
})
