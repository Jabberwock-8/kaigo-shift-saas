import type { Rule, Schedule, ShiftPattern, Staff } from '../../types/models'
import {
  daysInMonth as daysInMonthOf,
  formatMonthDayWeekday,
  formatYearMonthLabel,
  weekdayOf,
  WEEKDAY_LABELS,
} from '../../lib/dateUtils'
import { demandFor, shiftGroupDeficitPatternIds } from '../../domain/scheduler/demand'

type StaffWithId = Staff & { id: string }
type PatternWithId = ShiftPattern & { id: string }
type RuleWithId = Rule & { id: string }

interface Props {
  facilityName: string
  yearMonth: string
  staffList: StaffWithId[]
  schedule: Schedule | null
  shiftPatterns: PatternWithId[]
  rules: RuleWithId[]
  /** 週表示の印刷: その週の日だけを A4縦・名称と時刻つきで出す。未指定なら月全体（A4横） */
  days?: number[]
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
  rules,
  days: weekDays,
}: Props) {
  const isWeek = !!weekDays
  const dayList = weekDays ?? Array.from({ length: daysInMonthOf(yearMonth) }, (_, i) => i + 1)
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
      {/* @page は切り替えられないため、週の印刷のときだけ後勝ちで A4縦に上書きする */}
      {isWeek && <style>{'@media print { @page { size: A4 portrait; margin: 10mm; } }'}</style>}
      <div className="print-head">
        <span className="print-title">
          {formatYearMonthLabel(yearMonth)} 勤務表
          {isWeek && `（${formatMonthDayWeekday(yearMonth, dayList[0])}〜${formatMonthDayWeekday(yearMonth, dayList.at(-1)!)}）`}
        </span>
        <span>
          {facilityName}　印刷日: {new Date().toLocaleDateString('ja-JP')}
        </span>
      </div>
      <table className={`shift-grid${isWeek ? ' week' : ''}`}>
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
          {schedule?.events && Object.keys(schedule.events).length > 0 && (
            <tr className="event-row">
              <td className="namecol">行事</td>
              {dayList.map((d) => (
                <td key={d} className="print-cell">
                  {schedule.events?.[String(d)] ?? ''}
                </td>
              ))}
            </tr>
          )}
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
                    style={
                      pattern
                        ? { backgroundColor: pattern.color, color: pattern.textColor }
                        : undefined
                    }
                  >
                    {pattern?.code ?? ''}
                    {isWeek && pattern && (
                      <span className="week-cell-detail">
                        {pattern.label && <span>{pattern.label}</span>}
                        {pattern.startTime && pattern.endTime && (
                          <span>
                            {pattern.startTime}〜{pattern.endTime}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          {workPatterns.map((p) => (
            <tr key={p.id} className="tally-row">
              <td className="namecol">{p.code} 計</td>
              {dayList.map((d) => {
                const need = demandFor(rules, yearMonth, d)[p.id]
                const actual = countFor(p.id, d)
                if (need == null) {
                  const deficit = shiftGroupDeficitPatternIds(rules, yearMonth, d, (id) => countFor(id, d))
                  return (
                    <td key={d} className={deficit.has(p.id) ? 'tally-short' : undefined}>
                      {actual}
                    </td>
                  )
                }
                return (
                  <td key={d} className={actual < need ? 'tally-short' : undefined}>
                    {actual}/{need}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
