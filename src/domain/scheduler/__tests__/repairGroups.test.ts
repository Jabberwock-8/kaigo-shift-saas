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

describe('repairGroups: 同じ日の余っている勤務から付け替え', () => {
  // s1 だけの職場。10日は M 勤に入っていて、休みの職員がいない＝「休みの人を入れる」「別日から振り替える」手が使えない。
  // アミティホーム寺田の「M5 が2名いる日に A2 系が1名足りない」を模したもの
  const s1 = staff('s1', { workConditions: { maxWorkdaysPerMonth: 3 } })

  it('必要人数を超えて入っている勤務の人を、不足しているグループの勤務へ付け替える', () => {
    const g = grid({ s1: { 1: 'A', 2: 'A', 10: 'M' } })

    repairGroups(g, input({ staff: [s1], rules: [groupOn10] }))

    expect(['A', 'B']).toContain(g.s1['10'])
    // 同じ日の中での付け替えなので、勤務日数は変わらない
    expect(Object.values(g.s1).filter((p) => p !== 'off')).toHaveLength(3)
  })

  it('付け替え元の勤務がその日に必要な人数ぴったりなら動かさない', () => {
    const needM = rule({ kind: 'hard', days: { type: 'dates', values: ['2026-09-10'] }, target: { type: 'shift', value: 'M' }, cond: { type: 'atLeast', count: 1 } })
    const g = grid({ s1: { 1: 'A', 2: 'A', 10: 'M' } })

    repairGroups(g, input({ staff: [s1], rules: [groupOn10, needM] }))

    expect(g.s1['10']).toBe('M')
  })

  it('付け替え元の勤務が別の組み合わせ条件で必要なら動かさない', () => {
    const needMGroup = rule({
      kind: 'hard',
      days: { type: 'dates', values: ['2026-09-10'] },
      target: { type: 'shiftGroup', value: ['M'] },
      cond: { type: 'atLeastGroup', count: 1 },
    })
    const g = grid({ s1: { 1: 'A', 2: 'A', 10: 'M' } })

    repairGroups(g, input({ staff: [s1], rules: [groupOn10, needMGroup] }))

    expect(g.s1['10']).toBe('M')
  })

  it('「〜を優先」を崩さない人から付け替える', () => {
    // s1 は M 勤を優先したい人で、並び順は先頭。s2 は特に希望なし。どちらを動かしても不足は埋まる
    const s2 = staff('s2', { workConditions: { maxWorkdaysPerMonth: 3 } })
    const s1PrefersM = rule({ kind: 'soft', days: { type: 'all' }, target: { type: 'staff', value: 's1' }, cond: { type: 'preferShift', value: 'M' } })
    const g = grid({ s1: { 1: 'A', 2: 'A', 10: 'M' }, s2: { 3: 'A', 4: 'A', 10: 'M' } })

    repairGroups(g, input({ staff: [s1, s2], rules: [groupOn10, s1PrefersM] }))

    expect(g.s1['10']).toBe('M')
    expect(['A', 'B']).toContain(g.s2['10'])
  })

  it('ロックされた勤務は動かさない', () => {
    const g = grid({ s1: { 1: 'A', 2: 'A', 10: 'M' } })

    repairGroups(g, input({ staff: [s1], rules: [groupOn10], lockedCells: { s1: { '10': true } } }))

    expect(g.s1['10']).toBe('M')
  })
})
