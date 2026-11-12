import { describe, expect, it } from 'vitest'
import { buildNewScheduleWithWrites, stillEmptyCells } from './firestore'

// §18 A4: 勤務表が無い月に最初に書くときの内容が、従来の「空の表を作る → 項目を更新」と同じになること
describe('buildNewScheduleWithWrites', () => {
  const base = { yearMonth: '2026-11', daysInMonth: 30, status: 'draft', assignments: {}, locks: {}, revision: 1 }

  it('1マスの入力は assignments.職員ID.日 に入り、revision は 2（作成1＋更新1と同じ）', () => {
    const data = buildNewScheduleWithWrites(base, [{ path: ['assignments', 's1', '3'], value: 'p1' }])
    expect(data).toEqual({ ...base, assignments: { s1: { '3': 'p1' } }, revision: 2 })
  })

  it('消す指定（null）は何も書かない（空の表だけができる）', () => {
    const data = buildNewScheduleWithWrites(base, [{ path: ['locks', 's1', '3'], value: null }])
    expect(data).toEqual({ ...base, revision: 2 })
  })

  it('行事・兼務行・月の上限・ロック一括解除も同じ位置に入る', () => {
    expect(buildNewScheduleWithWrites(base, [{ path: ['events', '5'], value: '運動会' }]).events).toEqual({ '5': '運動会' })
    expect(
      buildNewScheduleWithWrites(base, [{ path: ['secondaryAssignments', 's2', '1'], value: 'p2' }]).secondaryAssignments,
    ).toEqual({ s2: { '1': 'p2' } })
    const override = { s1: { targetWorkdays: 20, maxWorkdays: null } }
    expect(buildNewScheduleWithWrites(base, [{ path: ['monthlyMaxDaysOverride'], value: override }]).monthlyMaxDaysOverride).toEqual(
      override,
    )
    expect(buildNewScheduleWithWrites(base, [{ path: ['locks'], value: {} }]).locks).toEqual({})
  })

  it('元の base（空の表の雛形）を書き換えない', () => {
    buildNewScheduleWithWrites(base, [{ path: ['assignments', 's1', '3'], value: 'p1' }])
    expect(base.assignments).toEqual({})
    expect(base.revision).toBe(1)
  })
})

// §19 C1: 書き込む直前の最新の勤務表で、ほかの人が入れたマス・ロックしたマスを外す
describe('stillEmptyCells', () => {
  const cells = [
    { staffId: 'a', day: 1 },
    { staffId: 'a', day: 2 },
    { staffId: 'b', day: 1 },
  ]

  it('勤務表が無ければ全部残す', () => {
    expect(stillEmptyCells(cells, null)).toEqual(cells)
  })

  it('入力済み・ロック済みのマスは外す（上書きしない）', () => {
    expect(stillEmptyCells(cells, { assignments: { a: { '1': 'X' } }, locks: { b: { '1': true } } })).toEqual([
      { staffId: 'a', day: 2 },
    ])
  })

  it('assignments・locks の無い古い勤務表でも動く', () => {
    expect(stillEmptyCells(cells, {} as never)).toEqual(cells)
  })
})
