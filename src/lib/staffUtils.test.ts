import { describe, expect, it } from 'vitest'
import { hasEntriesInMonth, staffJobTypeIds, staffShownInMonth } from './staffUtils'

describe('staffJobTypeIds', () => {
  it('配列があればそれを返す（兼務で複数）', () => {
    expect(staffJobTypeIds({ jobTypeIds: ['a', 'b'], jobTypeId: 'old' })).toEqual(['a', 'b'])
  })

  it('空配列は「職種なし」であり、旧・単数の値へ戻さない（編集中に全部外すと旧職種が復活したバグの再発防止）', () => {
    expect(staffJobTypeIds({ jobTypeIds: [], jobTypeId: 'old' })).toEqual([])
  })

  it('配列が無い旧データは単数の値を読む', () => {
    expect(staffJobTypeIds({ jobTypeId: 'old' })).toEqual(['old'])
  })

  it('どちらも無ければ空', () => {
    expect(staffJobTypeIds({})).toEqual([])
    expect(staffJobTypeIds({ jobTypeId: '' })).toEqual([])
  })
})

describe('staffShownInMonth（A2: 無効にした職員を過去の月に出す）', () => {
  const staff = [
    { id: 'a', active: true },
    { id: 'b', active: false },
    { id: 'c', active: false },
    { id: 'd' } as { id: string; active?: boolean }, // active の無い古いデータ＝有効
  ]

  it('有効な職員は入力が無くても出る。無効の職員は入力がある月だけ出る', () => {
    const shown = staffShownInMonth(staff, { b: { '3': 'p1' } })
    expect(shown.map((s) => s.id)).toEqual(['a', 'b', 'd'])
  })

  it('兼務行だけに入力がある無効の職員も出る', () => {
    expect(staffShownInMonth(staff, {}, { c: { '1': 'p2' } }).map((s) => s.id)).toEqual(['a', 'c', 'd'])
  })

  it('勤務表が無い月（undefined）・空の行・空文字だけの行では無効の職員は出ない', () => {
    expect(staffShownInMonth(staff, undefined).map((s) => s.id)).toEqual(['a', 'd'])
    expect(staffShownInMonth(staff, { b: {} }, { c: { '1': '' } }).map((s) => s.id)).toEqual(['a', 'd'])
  })

  it('無効の職員がいなければ、従来の「有効な職員だけ」と同じ結果', () => {
    const all = [{ id: 'a', active: true }, { id: 'd' }] as { id: string; active?: boolean }[]
    expect(staffShownInMonth(all, { a: { '1': 'p' } })).toEqual(all.filter((s) => s.active !== false))
  })

  it('hasEntriesInMonth', () => {
    expect(hasEntriesInMonth('x', { x: { '1': 'p' } })).toBe(true)
    expect(hasEntriesInMonth('x', { y: { '1': 'p' } })).toBe(false)
  })
})
