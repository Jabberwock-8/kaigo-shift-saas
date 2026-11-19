import { useRef } from 'react'
import { useMasters } from '../../context/MastersContext'
import { currentYearMonth } from '../../lib/dateUtils'
import { staffJobTypeIds } from '../../lib/staffUtils'
import { resolveLimits } from '../../domain/scheduler/limits'
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
/** マウスを乗せた列を光らせる（その列の data-day を持つマスに色を付ける。表を描き直さずに済むよう、style 要素の中身だけ変える） */
function hoverRule(day: string | null): string {
  if (!day || !/^\d+$/.test(day)) return ''
  return `.grid-scroll table.shift-grid td[data-day="${day}"], .grid-scroll table.shift-grid th[data-day="${day}"] { background-color: var(--color-grid-hover); }`
}

export default function ShiftGridTable({ g }: { g: ShiftGrid }) {
  const { jobTypes } = useMasters()
  const hoverStyleRef = useRef<HTMLStyleElement>(null)
  function handleHover(e: React.MouseEvent) {
    const cell = (e.target as HTMLElement).closest('[data-day]')
    if (hoverStyleRef.current) hoverStyleRef.current.textContent = hoverRule(cell?.getAttribute('data-day') ?? null)
  }
  function clearHover() {
    if (hoverStyleRef.current) hoverStyleRef.current.textContent = ''
  }
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
    employmentTypes,
    settings,
    days,
  } = g

  // 列の見た目（改善指示書 D4）。今日は表示中の月が今月のときだけ
  const todayDay = yearMonth === currentYearMonth() ? new Date().getDate() : null
  function colClass(d: number): string {
    const w = weekdayOf(yearMonth, d)
    return [w === 6 ? 'sat' : '', w === 0 ? 'sun' : '', w === 1 ? 'week-start' : '', d === todayDay ? 'today' : '']
      .filter(Boolean)
      .join(' ')
  }
  const jobLabelById = new Map(jobTypes.map((j) => [j.id, j.label]))
  /** 名前の下に出す「雇用区分・職種」と「勤務日数/必要日数」（必要日数が無い人は日数だけ） */
  function staffMeta(staff: (typeof staffList)[number]) {
    const emp = employmentTypes.find((e) => e.id === staff.employmentTypeId)?.label
    const jobs = staffJobTypeIds(staff)
      .map((id) => jobLabelById.get(id))
      .filter(Boolean)
      .join('・')
    const row = effectiveAssignments[staff.id] ?? {}
    const work = dayList.filter((d) => patternById.get(row[String(d)] ?? '')?.isWork).length
    const target = staff.excludeFromGeneration
      ? null
      : resolveLimits(staff, employmentTypes.find((e) => e.id === staff.employmentTypeId), settings, schedule?.monthlyMaxDaysOverride?.[staff.id], days)
          .targetWorkdays
    return { label: [emp, jobs].filter(Boolean).join('・'), work, target }
  }

  return (
    <>
      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <div className="grid-legend no-print" aria-label="表の印の説明">
          <span className="grid-legend-item"><span className="legend-swatch legend-viol">!</span>違反（マウスを乗せると詳細）</span>
          <span className="grid-legend-item"><span className="legend-swatch legend-wish-ok" />希望休が守れている</span>
          <span className="grid-legend-item"><span className="legend-swatch legend-wish-bad" />希望休なのに勤務</span>
          <span className="grid-legend-item"><span className="legend-swatch legend-lock" />ロック（右クリックで切り替え）</span>
          <span className="grid-legend-item"><span className="legend-swatch legend-sat" />土曜</span>
          <span className="grid-legend-item"><span className="legend-swatch legend-sun" />日曜</span>
          <span className="grid-legend-item"><span className="legend-swatch legend-today" />今日</span>
          <span className="grid-legend-hint">マスをクリックすると勤務を選べます</span>
        </div>
      )}
      <style ref={hoverStyleRef} />
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
          <table
            className={`shift-grid${isWeek ? ' week' : ''}`}
            ref={gridTableRef}
            onMouseOver={handleHover}
            onMouseLeave={clearHover}
          >
            <thead>
              <tr>
                <th className="namecol">職員</th>
                {visibleDays.map((d) => {
                  const w = weekdayOf(yearMonth, d)
                  return (
                    <th key={d} className={colClass(d)} data-day={d}>
                      <span className="day-num">{d}</span>
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
                      className={[colClass(d), canEditMonth && !previewCandidate ? 'clickable' : ''].filter(Boolean).join(' ') || undefined}
                      data-day={d}
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
                      {(() => {
                        const meta = staffMeta(staff)
                        return (
                          <>
                            <div className="name-line">
                              <span className="name-text">
                                {staff.name}
                                {staff.active === false && <span className="muted">（無効）</span>}
                                {staffMsgs.length > 0 && (
                                  <span className="warn">
                                    {' '}
                                    <TriangleAlert className="ico" size={14} aria-label="この職員に違反があります" />
                                  </span>
                                )}
                              </span>
                              <span
                                className={`name-count${meta.target != null && meta.work < meta.target ? ' short' : ''}`}
                                title={meta.target != null ? `勤務日数 ${meta.work}日 ／ 必要日数 ${meta.target}日` : `勤務日数 ${meta.work}日`}
                              >
                                {meta.target != null ? `${meta.work}/${meta.target}` : `${meta.work}日`}
                              </span>
                            </div>
                            {meta.label && <div className="name-meta">{meta.label}</div>}
                          </>
                        )
                      })()}
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
                        colClass(d),
                        cellMsgs.length > 0 ? 'viol' : '',
                        wish ? (wishBroken ? 'wish-bad' : 'wish-ok') : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      const title = cellMsgs.length > 0 ? cellMsgs.join('\n') : undefined
                      return (
                        <td key={d} className={cellClass} title={title} data-day={d}>
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
                          <td key={d} className={`grid-cell ${colClass(d)}`.trim()} data-day={d}>
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
                        <td key={d} className={[colClass(d), deficit.has(p.id) ? 'tally-short' : ''].filter(Boolean).join(' ') || undefined} data-day={d}>
                          {actual}
                        </td>
                      )
                    }
                    return (
                      <td key={d} className={[colClass(d), actual < need ? 'tally-short' : ''].filter(Boolean).join(' ') || undefined} data-day={d}>
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
