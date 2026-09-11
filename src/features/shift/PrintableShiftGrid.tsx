import type { Schedule, ShiftPattern, Staff } from '../../types/models'
import {
  daysInMonth as daysInMonthOf,
  formatYearMonthLabel,
  weekdayOf,
  WEEKDAY_LABELS,
} from '../../lib/dateUtils'

type StaffWithId = Staff & { id: string }
type PatternWithId = ShiftPattern & { id: string }

interface Props {
  facilityName: string
  yearMonth: string
  staffList: StaffWithId[]
  schedule: Schedule | null
  shiftPatterns: PatternWithId[]
}

/**
 * 印刷専用のシンプルな表。画面には出さず（CSSの @media print で切替）、
 * window.print() のときだけ表示する。プルダウンではなく記号をそのまま出す。
 */
export default function PrintableShiftGrid({
  facilityName,
  yearMonth,
  staffList,
  schedule,
  shiftPatterns,
}: Props) {
  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const workPatterns = shiftPatterns.filter((p) => p.isWork)

  function countFor(patternId: string, day: number): number {
    let count = 0
    for (const staff of staffList) {
      if (schedule?.assignments?.[staff.id]?.[String(day)] === patternId) count++
    }
    return count
  }

  return (
    <div className="print-only">
      <div className="print-head">
        <span className="print-title">{formatYearMonthLabel(yearMonth)} 勤務表</span>
        <span>
          {facilityName}　印刷日: {new Date().toLocaleDateString('ja-JP')}
        </span>
      </div>
      <table className="shift-grid">
        <thead>
          <tr>
            <th className="namecol">職員</th>
            {dayList.map((d) => {
              const w = weekdayOf(yearMonth, d)
              return (
                <th key={d} className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>
                  {d}
                  <br />
                  <span className="dow">{WEEKDAY_LABELS[w]}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {staffList.map((staff) => (
            <tr key={staff.id}>
              <td className="namecol">{staff.name}</td>
              {dayList.map((d) => {
                const patternId = schedule?.assignments?.[staff.id]?.[String(d)]
                const pattern = patternId ? patternById.get(patternId) : undefined
                return (
                  <td
                    key={d}
                    className="print-cell"
                    style={pattern?.color ? { backgroundColor: pattern.color } : undefined}
                  >
                    {pattern?.code ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
          {workPatterns.map((p) => (
            <tr key={p.id} className="tally-row">
              <td className="namecol">{p.code} 計</td>
              {dayList.map((d) => (
                <td key={d}>{countFor(p.id, d) || ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
