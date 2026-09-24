import { describe, expect, it } from 'vitest'
import { buildDayPatternCaps, withinDayPatternCap } from '../caps'
import { DAYS, WEEKENDS, YM, rule } from './fixtures'

describe('buildDayPatternCaps', () => {
  it('「配置しない」は対象日だけ上限0になり、それ以外の日は上限なし', () => {
    const caps = buildDayPatternCaps(
      [rule({ kind: 'hard', days: { type: 'weekend' }, target: { type: 'shift', value: 'A' }, cond: { type: 'none' } })],
      YM,
      DAYS,
    )
    for (const d of WEEKENDS) expect(caps.get(d)?.get('A')).toBe(0)
    expect(caps.get(1)).toBeUndefined()
    expect(caps.get(7)).toBeUndefined()
  })

  it('「N名以下」はその人数が上限になり、同じパターンに複数あれば小さい方を採る', () => {
    const caps = buildDayPatternCaps(
      [
        rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atMost', count: 3 } }),
        rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atMost', count: 2 } }),
      ],
      YM,
      DAYS,
    )
    expect(caps.get(1)?.get('A')).toBe(2)
  })

  it('同じパターンに必要人数（N名以上）があれば、上限をそこまで引き上げる（矛盾データで充足率を下げない）', () => {
    const caps = buildDayPatternCaps(
      [
        rule({ kind: 'hard', days: { type: 'weekend' }, target: { type: 'shift', value: 'A' }, cond: { type: 'none' } }),
        rule({ kind: 'hard', days: { type: 'weekend' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 2 } }),
      ],
      YM,
      DAYS,
    )
    expect(caps.get(5)?.get('A')).toBe(2)
  })

  it('推奨・無効・シフト以外のルールは上限にしない', () => {
    const caps = buildDayPatternCaps(
      [
        rule({ kind: 'soft', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'none' } }),
        rule({ kind: 'hard', enabled: false, days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'none' } }),
        rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shiftGroup', value: ['A', 'B'] }, cond: { type: 'atLeastGroup', count: 1 } }),
      ],
      YM,
      DAYS,
    )
    expect(caps.size).toBe(0)
  })
})

describe('withinDayPatternCap', () => {
  const caps = new Map([[5, new Map([['A', 0], ['B', 2]])]])

  it('上限が無ければ人数を数えずに true', () => {
    let counted = false
    expect(withinDayPatternCap(caps, 1, 'A', () => ((counted = true), 99))).toBe(true)
    expect(counted).toBe(false)
  })

  it('上限0なら人数を数えずに false', () => {
    let counted = false
    expect(withinDayPatternCap(caps, 5, 'A', () => ((counted = true), 0))).toBe(false)
    expect(counted).toBe(false)
  })

  it('上限Nなら、すでにN人いれば false', () => {
    expect(withinDayPatternCap(caps, 5, 'B', () => 1)).toBe(true)
    expect(withinDayPatternCap(caps, 5, 'B', () => 2)).toBe(false)
  })

  it('caps 自体が未設定なら常に true（旧挙動への縮退）', () => {
    expect(withinDayPatternCap(undefined, 5, 'A', () => 0)).toBe(true)
  })
})
