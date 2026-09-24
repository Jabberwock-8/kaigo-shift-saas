import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateOne } from '../generateOne'
import { GENERATION_DEFAULTS_V1 } from '../defaults'
import { DAYS, input, rule, staff } from './fixtures'

const profile = GENERATION_DEFAULTS_V1.profiles[0]

afterEach(() => {
  vi.restoreAllMocks()
})

function countOf(grid: Record<string, Record<string, string>>, staffId: string, patternId: string) {
  return Array.from({ length: DAYS }, (_, i) => grid[staffId]?.[String(i + 1)]).filter((p) => p === patternId).length
}

describe('「〜を優先」ルール', () => {
  it('上位候補からの抽選に打ち消されず、優先している勤務に入る', () => {
    // 5人とも A 勤・M 勤ができ、両方とも毎日1名必要。s1 だけが「M 勤を優先」。
    // 担当者は優先度の上位3人から抽選されるため、抽選で常に3番手を引く状態を作る。
    // 修正前は優先で順位が上がっても抽選で外れ、s1 は M 勤に1日も入らなかった
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) => staff(id))
    const rules = [
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'A' }, cond: { type: 'atLeast', count: 1 } }),
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'M' }, cond: { type: 'atLeast', count: 1 } }),
      rule({ kind: 'soft', days: { type: 'all' }, target: { type: 'staff', value: 's1' }, cond: { type: 'preferShift', value: 'M' } }),
    ]
    const { assignments } = generateOne(input({ staff: staffList, rules }), profile)

    const onM = countOf(assignments, 's1', 'M')
    const onA = countOf(assignments, 's1', 'A')
    // 5人で均等に分けた場合の取り分（6日）以上は M 勤に入る
    expect(onM).toBeGreaterThanOrEqual(6)
    // 勤務するときは、優先していない A 勤より M 勤に入る
    expect(onM).toBeGreaterThan(onA)
  })

  it('重みを0にすると従来の挙動（優先を配置に反映しない）に戻る', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const staffList = ['s1', 's2', 's3', 's4', 's5'].map((id) => staff(id))
    const rules = [
      rule({ kind: 'hard', days: { type: 'all' }, target: { type: 'shift', value: 'M' }, cond: { type: 'atLeast', count: 1 } }),
      rule({ kind: 'soft', days: { type: 'all' }, target: { type: 'staff', value: 's1' }, cond: { type: 'preferShift', value: 'M' } }),
    ]
    const { assignments } = generateOne(input({ staff: staffList, rules }, { preferShiftWeight: 0 }), profile)

    expect(countOf(assignments, 's1', 'M')).toBe(0)
  })
})
