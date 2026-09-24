import { describe, expect, it } from 'vitest'
import { staffJobTypeIds } from './staffUtils'

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
