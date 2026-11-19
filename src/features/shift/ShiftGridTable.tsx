import { TriangleAlert } from 'lucide-react'
import { Fragment } from 'react'
import { formatDate, weekdayOf, WEEKDAY_LABELS } from '../../lib/dateUtils'
import { demandFor, shiftGroupDeficitPatternIds } from '../../domain/scheduler/demand'
import type { ShiftGrid } from './useShiftGrid'

/** 週表示のセルに、記号の下へ名称と時刻を添える */
function WeekCellDetail({ pattern }: { pattern: { label?: string; startTime?: string; endTime?: string } }) {
  const time = pattern.startTime && pattern.endTime ? `${pattern.startTime}〜${pattern.endTime}` : ''
  return (
    <span className="week-cell-detail">
      {pattern.label && <span>{pattern.label}</span>}
      {time && <span>{time}</span>}
    </span>
  )
}

/**
 * シフト表の本体（行事の行・職員の行・兼務の行・日別の集計）。
 * 改善指示書 D7 で ShiftGridPage.tsx から分けた（remaining-work-design.md §26）。
 */
export default function ShiftGridTable({ g }: { g: ShiftGrid }) {
  const {
    shiftPatterns,
    yearMonth,
    schedule,
    staffList,
    rules,
    setPicker,
    setEventPicker,
    fitToScreen,
    fitScale,
    naturalSize,
    gridScrollRef,
    gridTableRef,
    dayList,
    isWeek,
    visibleDays,
    canEditMonth,
    previewCandidate,
    effectiveAssignments,
    checkResult,
    wishDates,
    patternById,
    summaryPatterns,
    workPatterns,
    fteFor,
    actualCountFor,
    handleToggleLock,
  } = g
  return (
    <>
      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <div
          className="grid-scroll no-print"
          ref={gridScrollRef}
          style={
            fitToScreen
              ? { overflow: 'hidden', maxHeight: 'none', height: naturalSize.h ? naturalSize.h * fitScale.y : undefined }
              : undefined
          }
        >
          <div style={fitToScreen ? { transform: `scale(${fitScale.x}, ${fitScale.y})`, transformOrigin: 'top left', width: naturalSize.w || undefined } : undefined}>
          <table className={`shift-grid${isWeek ? ' week' : ''}`} ref={gridTableRef}>
            <thead>
              <tr>
                <th className="namecol">職員</th>
                {visibleDays.map((d) => {
                  const w = weekdayOf(yearMonth, d)
                  return (
                    <th key={d} className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>
                      {d}
                      <br />
                      <span className="dow">{WEEKDAY_LABELS[w]}</span>
                    </th>
                  )
                })}
                {!isWeek &&
                  summaryPatterns.map((p) => (
                    <th key={p.id} className="sumcol">
                      {p.code}
                    </th>
                  ))}
                {!isWeek && (
                  <th className="sumcol" title="常勤換算（実労働時間 ÷ 常勤の所定労働時間）">
                    常勤換算
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr className="event-row">
                <td className="namecol">行事</td>
                {visibleDays.map((d) => {
                  const text = schedule?.events?.[String(d)] ?? ''
                  return (
                    <td
                      key={d}
                      className={canEditMonth && !previewCandidate ? 'clickable' : undefined}
                      title={text || undefined}
                      onClick={(e) => {
                        if (!canEditMonth || previewCandidate) return
                        setEventPicker({ day: d, rect: e.currentTarget.getBoundingClientRect() })
                      }}
                    >
                      {text}
                    </td>
                  )
                })}
                {!isWeek && summaryPatterns.map((p) => <td key={p.id} className="sumcol" />)}
                {!isWeek && <td className="sumcol" />}
              </tr>
              {staffList.map((staff) => {
                const staffMsgs = checkResult.staffMessages[staff.id] ?? []
                const staffAssignments = effectiveAssignments[staff.id] ?? {}
                return (
                  <Fragment key={staff.id}>
                  <tr>
                    <td className="namecol" title={staffMsgs.join('\n') || undefined}>
                      {staff.name}
                      {staff.active === false && <span className="muted">（無効）</span>}
                      {staffMsgs.length > 0 && (
                        <span className="warn">
                          {' '}
                          <TriangleAlert className="ico" size={14} aria-label="この職員に違反があります" />
                        </span>
                      )}
                    </td>
                    {visibleDays.map((d) => {
                      const patternId = staffAssignments[String(d)] ?? ''
                      const locked = !previewCandidate && (schedule?.locks?.[staff.id]?.[String(d)] ?? false)
                      const pattern = patternById.get(patternId)
                      const cellMsgs = checkResult.cellMessages[staff.id]?.[d] ?? []
                      const wish = wishDates.get(`${staff.id}_${formatDate(yearMonth, d)}`)
                      const wishBroken = !!wish && !!pattern?.isWork
                      const cellClass = [
                        'grid-cell',
                        cellMsgs.length > 0 ? 'viol' : '',
                        wish ? (wishBroken ? 'wish-bad' : 'wish-ok') : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      const title = cellMsgs.length > 0 ? cellMsgs.join('\n') : undefined
                      return (
                        <td key={d} className={cellClass} title={title}>
                          <div className="cell-wrap">
                            <div
                              className="cell-code"
                              style={
                                pattern
                                  ? { backgroundColor: pattern.color, color: pattern.textColor }
                                  : undefined
                              }
                              onClick={(e) => {
                                if (!canEditMonth || previewCandidate) return
                                setPicker({
                                  staffId: staff.id,
                                  day: d,
                                  rect: e.currentTarget.getBoundingClientRect(),
                                  kind: 'primary',
                                })
                              }}
                              onContextMenu={(e) => {
                                // ロックはパネルを開かず右クリックだけで切り替えられるようにする
                                if (!canEditMonth || previewCandidate) return
                                e.preventDefault()
                                void handleToggleLock(staff.id, d, locked)
                              }}
                            >
                              {pattern?.code ?? ''}
                              {isWeek && pattern && <WeekCellDetail pattern={pattern} />}
                            </div>
                            {locked && <span className="lock-dot" title="ロック中" />}
                            {cellMsgs.length > 0 && <span className="viol-mark">!</span>}
                          </div>
                        </td>
                      )
                    })}
                    {!isWeek && summaryPatterns.map((p) => {
                      const count = dayList.filter((d) => staffAssignments[String(d)] === p.id).length
                      return (
                        <td
                          key={p.id}
                          className="sumcol"
                          style={count && p.textColor ? { color: p.textColor, fontWeight: 700 } : undefined}
                        >
                          {count || ''}
                        </td>
                      )
                    })}
                    {!isWeek && <td className="sumcol">{fteFor(staff.id)?.toFixed(1) ?? ''}</td>}
                  </tr>
                  {staff.traits?.includes('生活相談員') && (
                    <tr key={`${staff.id}-secondary`} className="secondary-role-row">
                      <td className="namecol">└ 生活相談員</td>
                      {visibleDays.map((d) => {
                        const patternId = schedule?.secondaryAssignments?.[staff.id]?.[String(d)] ?? ''
                        const pattern = patternById.get(patternId)
                        return (
                          <td key={d} className="grid-cell">
                            <div className="cell-wrap">
                              <div
                                className="cell-code"
                                style={
                                  pattern
                                    ? { backgroundColor: pattern.color, color: pattern.textColor }
                                    : undefined
                                }
                                onClick={(e) => {
                                  if (!canEditMonth || previewCandidate) return
                                  setPicker({
                                    staffId: staff.id,
                                    day: d,
                                    rect: e.currentTarget.getBoundingClientRect(),
                                    kind: 'secondary',
                                  })
                                }}
                              >
                                {pattern?.code ?? ''}
                                {isWeek && pattern && <WeekCellDetail pattern={pattern} />}
                              </div>
                            </div>
                          </td>
                        )
                      })}
                      {!isWeek && summaryPatterns.map((p) => <td key={p.id} className="sumcol" />)}
                      {!isWeek && <td className="sumcol" />}
                    </tr>
                  )}
                  </Fragment>
                )
              })}
              {workPatterns.map((p) => (
                <tr key={p.id} className="tally-row">
                  <td className="namecol">{p.code} 計</td>
                  {visibleDays.map((d) => {
                    const need = demandFor(rules, yearMonth, d)[p.id]
                    const actual = actualCountFor(p.id, d)
                    if (need == null) {
                      const deficit = shiftGroupDeficitPatternIds(rules, yearMonth, d, (id) => actualCountFor(id, d))
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
                  {!isWeek && summaryPatterns.map((sp) => <td key={sp.id} className="sumcol" />)}
                  {!isWeek && <td className="sumcol" />}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

    </>
  )
}
