import { describe, expect, it } from 'vitest'
import { buildSubmissionRows, defaultWorkStyle, reportHoursOf } from './buildSubmissionRows'

const P = {
  B2: { id: 'B2', code: 'B2', label: 'B2', startTime: '09:00', endTime: '18:00', breakHours: 1, isWork: true, isNight: false, category: 'day' as const },
  N6: { id: 'N6', code: 'N6', label: 'N6', startTime: '16:00', endTime: '10:00', breakHours: 2, isWork: true, isNight: true, category: 'night' as const, reportHours: 8 },
  AKE: { id: 'AKE', code: '明出', label: '明出', isWork: true, isNight: false, category: 'afterNight' as const, reportHours: 8 },
  AKE_REST: { id: 'AKER', code: '明休', label: '明休', isWork: false, isNight: false, category: 'afterNight' as const },
  OFF: { id: 'OFF', code: '公休', label: '公休', isWork: false, isNight: false, category: 'off' as const },
  PAID: { id: 'PAID', code: '有給', label: '有給', isWork: false, isNight: false, category: 'paidLeave' as const },
}

describe('reportHoursOf', () => {
  it('時刻から休憩を引いた時間。届出用の時間があればそちら。有給は「休」、休みは空', () => {
    expect(reportHoursOf(P.B2)).toBe(8)
    expect(reportHoursOf(P.N6)).toBe(8)
    expect(reportHoursOf(P.AKE)).toBe(8)
    expect(reportHoursOf(P.AKE_REST)).toBeNull()
    expect(reportHoursOf(P.OFF)).toBeNull()
    expect(reportHoursOf(P.PAID)).toBe('休')
  })
})

describe('buildSubmissionRows', () => {
  it('2施設をまとめ、職種ごと（管理者・サビ管が先）に並べ、勤務形態・資格は未設定なら自動で決める', () => {
    const common = {
      shiftPatterns: Object.values(P),
      jobTypes: [
        { id: 'j1', label: '生活支援員' },
        { id: 'j2', label: 'サービス管理責任者' },
      ],
      employmentTypes: [
        { id: 'full', label: '常勤', hasTargetWorkdays: true },
        { id: 'part', label: '非常勤', hasTargetWorkdays: false },
      ],
    }
    const rows = buildSubmissionRows(
      [
        {
          ...common,
          staff: [
            { id: 'a', name: '山田　一郎', active: true, order: 1, jobTypeIds: ['j1'], employmentTypeId: 'full', qualifications: ['介護福祉士'] },
            { id: 'b', name: '佐藤　花子', active: true, order: 2, jobTypeIds: ['j1'], employmentTypeId: 'part' },
          ],
          assignments: { a: { '1': 'N6', '2': 'AKE', '3': 'OFF', '4': 'PAID' }, b: { '1': 'B2' } },
        },
        {
          ...common,
          staff: [
            { id: 'c', name: '鈴木　次郎', active: true, order: 1, jobTypeIds: ['j2'], employmentTypeId: 'full', report: { workStyle: 'B', note: '管理者と兼務' } },
            { id: 'd', name: '退職　者', active: false, order: 2, jobTypeIds: ['j1'] },
          ],
          assignments: { c: { '1': 'B2' } },
        },
      ],
      30,
    )
    expect(rows.map((r) => r.name)).toEqual(['鈴木 次郎', '山田 一郎', '佐藤 花子'])
    expect(rows[0]).toMatchObject({ jobTitle: 'サービス管理責任者', workStyle: 'B', note: '管理者と兼務' })
    expect(rows[1]).toMatchObject({ jobTitle: '生活支援員', workStyle: 'A', qualification: '介護福祉士' })
    expect(rows[1].hours.slice(0, 5)).toEqual([8, 8, null, '休', null])
    expect(rows[2].workStyle).toBe('C')
    // 30日の月は31日目を空ける
    expect(rows[1].hours).toHaveLength(31)
    expect(rows[1].hours[30]).toBeNull()
  })
})

describe('defaultWorkStyle', () => {
  it('名前が非常勤・パートなら必要勤務日数を使う区分でも C、常勤なら A', () => {
    expect(defaultWorkStyle({ label: '非常勤', hasTargetWorkdays: true })).toBe('C')
    expect(defaultWorkStyle({ label: 'パート', hasTargetWorkdays: true })).toBe('C')
    expect(defaultWorkStyle({ label: '常勤', hasTargetWorkdays: false })).toBe('A')
    expect(defaultWorkStyle({ label: '夜勤専従', hasTargetWorkdays: true })).toBe('A')
    expect(defaultWorkStyle(undefined)).toBe('C')
  })
})
