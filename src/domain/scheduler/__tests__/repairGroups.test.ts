import { describe, expect, it } from 'vitest'
import { repairGroups } from '../repair'
import type { AssignmentGrid } from '../types'
import { DAYS, input, rule, staff } from './fixtures'

/** 指定の勤務を置いたグリッドを作る（それ以外は公休） */
function grid(cells: Record<string, Record<number, string>>): AssignmentGrid {
  const g: AssignmentGrid = {}
  for (const [staffId, byDay] of Object.entries(cells)) {
    g[staffId] = {}
    for (let d = 1; d <= DAYS; d++) g[staffId][String(d)] = byDay[d] ?? 'off'
  }
  return g
}

const groupOn10 = rule({
  kind: 'hard',
  days: { type: 'dates', values: ['2026-09-10'] },
  target: { type: 'shiftGroup', value: ['A', 'B'] },
  cond: { type: 'atLeastGroup', count: 1 },
})

// 2人とも月3日が上限で、すでに3日使い切っている。10日は2人とも公休
const staffList = [
  staff('s1', { workConditions: { maxWorkdaysPerMonth: 3 } }),
  staff('s2', { workConditions: { maxWorkdaysPerMonth: 3 } }),
]
const workedCount = (g: AssignmentGrid, id: string) => Object.values(g[id]).filter((p) => p !== 'off').length
const groupTotalOn = (g: AssignmentGrid, day: number) =>
  staffList.filter((s) => ['A', 'B'].includes(g[s.id][String(day)])).length

describe('repairGroups: 2手修復', () => {
  it('全員が月の上限に達していても、別日の余っている勤務を振り替えて不足日を埋める', () => {
    const g = grid({ s1: { 1: 'A', 2: 'A', 3: 'A' }, s2: { 4: 'B', 5: 'B', 6: 'B' } })

    repairGroups(g, input({ staff: staffList, rules: [groupOn10] }))

    expect(groupTotalOn(g, 10)).toBeGreaterThanOrEqual(1)
    // 振り替えなので、勤務日数は増えない（上限を超えない）
    expect(workedCount(g, 's1')).toBe(3)
    expect(workedCount(g, 's2')).toBe(3)
  })

  it('振り替え元の日が別の組み合わせ条件で必要なら、そこは崩さない', () => {
    // 1〜6日にも「A または B を1名以上」があり、各日1人しかいない＝どの勤務も動かせない
    const groupOn1to6 = rule({
      kind: 'hard',
      days: { type: 'dates', values: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'] },
      target: { type: 'shiftGroup', value: ['A', 'B'] },
      cond: { type: 'atLeastGroup', count: 1 },
    })
    const g = grid({ s1: { 1: 'A', 2: 'A', 3: 'A' }, s2: { 4: 'B', 5: 'B', 6: 'B' } })

    repairGroups(g, input({ staff: staffList, rules: [groupOn10, groupOn1to6] }))

    for (let d = 1; d <= 6; d++) expect(groupTotalOn(g, d), `${d}日が崩れた`).toBe(1)
    // 動かせる勤務が無いので、10日は埋まらないのが正しい
    expect(groupTotalOn(g, 10)).toBe(0)
  })

  it('希望休の日には振り替えない', () => {
    const g = grid({ s1: { 1: 'A', 2: 'A', 3: 'A' }, s2: { 4: 'B', 5: 'B', 6: 'B' } })

    repairGroups(
      g,
      input({ staff: staffList, rules: [groupOn10], wishes: [{ staffId: 's1', day: 10 }, { staffId: 's2', day: 10 }] }),
    )

    expect(g.s1['10']).toBe('off')
    expect(g.s2['10']).toBe('off')
  })
})
