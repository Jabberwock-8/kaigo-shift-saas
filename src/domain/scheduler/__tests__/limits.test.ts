import { describe, expect, it } from 'vitest'
import { employmentTypeUsesTargetWorkdays, resolveLimits } from '../limits'
import { FULL, PART, settings, staff } from './fixtures'

const PART_ON = { ...PART, hasTargetWorkdays: true }

describe('employmentTypeUsesTargetWorkdays', () => {
  it('フラグがONの雇用区分では下限が効く', () => {
    expect(employmentTypeUsesTargetWorkdays(PART_ON)).toBe(true)
  })

  it('フラグがOFFでも表示名が「常勤」なら下限が効く（設定忘れの救済）', () => {
    expect(employmentTypeUsesTargetWorkdays({ label: '常勤', hasTargetWorkdays: false })).toBe(true)
  })

  it('フラグがOFFの非常勤では下限が効かない（アミティで亀山・中田が月5日しか入らなかった原因）', () => {
    expect(employmentTypeUsesTargetWorkdays(PART)).toBe(false)
  })

  it('雇用区分が未設定なら下限は効かない', () => {
    expect(employmentTypeUsesTargetWorkdays(undefined)).toBe(false)
  })
})

describe('resolveLimits', () => {
  it('優先順は 月別上書き → 職員 → 施設既定', () => {
    const s = staff('s1', { workConditions: { targetWorkdaysPerMonth: 18, maxWorkdaysPerMonth: 19 } })
    const st = settings({ monthlyLimitsDefault: { targetWorkdays: 15, maxWorkdays: 16, maxNightShifts: null } })

    expect(resolveLimits(s, FULL, st, { targetWorkdays: 20, maxWorkdays: 20 })).toMatchObject({
      targetWorkdays: 20,
      maxWorkdays: 20,
    })
    expect(resolveLimits(s, FULL, st)).toMatchObject({ targetWorkdays: 18, maxWorkdays: 19 })
    expect(resolveLimits(staff('s2'), FULL, st)).toMatchObject({ targetWorkdays: 15, maxWorkdays: 16 })
  })

  it('下限が効かない雇用区分では、職員に下限を入れても null になる（上限は効く）', () => {
    const s = staff('s1', { employmentTypeId: 'part', workConditions: { targetWorkdaysPerMonth: 17, maxWorkdaysPerMonth: 17 } })
    expect(resolveLimits(s, PART, settings())).toMatchObject({ targetWorkdays: null, maxWorkdays: 17 })
  })

  it('月別上書きの 0 は「0日」として扱い、下の階層へフォールバックしない（入職前の職員を外す用途）', () => {
    const s = staff('s1', { workConditions: { targetWorkdaysPerMonth: 20, maxWorkdaysPerMonth: 20 } })
    expect(resolveLimits(s, FULL, settings(), { targetWorkdays: 0, maxWorkdays: 0 })).toMatchObject({
      targetWorkdays: 0,
      maxWorkdays: 0,
    })
  })
})
