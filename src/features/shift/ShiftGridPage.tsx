import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import {
  DEFAULT_SHIFT_RULES_SETTINGS,
  fetchLeaveRequestsForMonth,
  fetchSchedule,
  fetchShiftRulesSettings,
  fetchStaffList,
  listCompatibilities,
  listRules,
  setAssignment,
  setLock,
} from '../../lib/firestore'
import type {
  Compatibility,
  LeaveRequest,
  Rule,
  Schedule,
  ShiftRulesSettings,
  Staff,
} from '../../types/models'
import {
  currentYearMonth,
  daysInMonth as daysInMonthOf,
  formatDate,
  formatMonthDayWeekday,
  formatYearMonthLabel,
  shiftYearMonth,
  weekdayOf,
  WEEKDAY_LABELS,
} from '../../lib/dateUtils'
import { checkMonth } from '../../domain/scheduler/check'
import PrintableShiftGrid from './PrintableShiftGrid'
import CellPicker from './CellPicker'

type StaffWithId = Staff & { id: string }

export default function ShiftGridPage() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId, facilities } = useFacility()
  const { shiftPatterns, employmentTypes, loading: mastersLoading } = useMasters()
  const isAdmin = appUser?.role === 'admin'
  const facilityName = facilities.find((f) => f.id === selectedFacilityId)?.name ?? ''

  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [rules, setRules] = useState<(Rule & { id: string })[]>([])
  const [compatibilities, setCompatibilities] = useState<(Compatibility & { id: string })[]>([])
  const [wishes, setWishes] = useState<(LeaveRequest & { id: string })[]>([])
  const [settings, setSettings] = useState<ShiftRulesSettings>(DEFAULT_SHIFT_RULES_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ staffId: string; day: number; rect: DOMRect } | null>(
    null,
  )

  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [sl, sc, rl, cl, wl, st] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchSchedule(selectedFacilityId, yearMonth),
        listRules(selectedFacilityId),
        listCompatibilities(selectedFacilityId),
        fetchLeaveRequestsForMonth(selectedFacilityId, yearMonth),
        fetchShiftRulesSettings(selectedFacilityId),
      ])
      setStaffList(sl.filter((s) => s.active !== false))
      setSchedule(sc)
      setRules(rl)
      setCompatibilities(cl)
      setWishes(wl)
      setSettings(st)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId, yearMonth])

  const checkResult = useMemo(
    () =>
      checkMonth({
        yearMonth,
        daysInMonth: days,
        staff: staffList,
        employmentTypes,
        shiftPatterns,
        assignments: schedule?.assignments ?? {},
        rules,
        compatibilities,
        settings,
      }),
    [yearMonth, days, staffList, employmentTypes, shiftPatterns, schedule, rules, compatibilities, settings],
  )

  const wishDates = useMemo(() => {
    const map = new Map<string, LeaveRequest & { id: string }>()
    wishes.forEach((w) => map.set(`${w.staffId}_${w.date}`, w))
    return map
  }, [wishes])

  if (!selectedFacilityId) return null

  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const summaryPatterns = shiftPatterns.filter((p) => p.isWork || p.category === 'off')

  function optionsFor(staff: StaffWithId) {
    const allowed = staff.workConditions?.workablePatternIds
    if (allowed && allowed.length > 0) {
      return shiftPatterns.filter(
        (p) => allowed.includes(p.id) || p.isSystem || !p.isWork,
      )
    }
    return shiftPatterns
  }

  async function handleAssign(staffId: string, day: number, patternId: string) {
    if (!user) return
    // 楽観的に画面を先に更新
    setSchedule((prev) => {
      const base: Schedule = prev ?? {
        yearMonth,
        daysInMonth: days,
        assignments: {},
        locks: {},
      }
      const assignments = { ...(base.assignments ?? {}) }
      const staffRow = { ...(assignments[staffId] ?? {}) }
      if (patternId) staffRow[String(day)] = patternId
      else delete staffRow[String(day)]
      assignments[staffId] = staffRow
      return { ...base, assignments }
    })
    try {
      await setAssignment(
        selectedFacilityId!,
        yearMonth,
        days,
        staffId,
        day,
        patternId || null,
        user.uid,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
    }
  }

  async function handleToggleLock(staffId: string, day: number, currentlyLocked: boolean) {
    if (!user) return
    setSchedule((prev) => {
      const base: Schedule = prev ?? {
        yearMonth,
        daysInMonth: days,
        assignments: {},
        locks: {},
      }
      const locks = { ...(base.locks ?? {}) }
      const staffRow = { ...(locks[staffId] ?? {}) }
      if (!currentlyLocked) staffRow[String(day)] = true
      else delete staffRow[String(day)]
      locks[staffId] = staffRow
      return { ...base, locks }
    })
    try {
      await setLock(selectedFacilityId!, yearMonth, days, staffId, day, !currentlyLocked, user.uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
    }
  }

  return (
    <section className="card">
      <div className="page-header no-print">
        <h2>{formatYearMonthLabel(yearMonth)} のシフト表</h2>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setYearMonth((ym) => shiftYearMonth(ym, -1))
            }}
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setYearMonth(currentYearMonth())
            }}
          >
            今月
          </button>
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setYearMonth((ym) => shiftYearMonth(ym, 1))
            }}
          >
            ▶
          </button>
          <button type="button" onClick={() => window.print()}>
            🖨 印刷
          </button>
        </div>
      </div>

      {!loading && !mastersLoading && (checkResult.hardCount > 0 || checkResult.softCount > 0) && (
        <p className="no-print" style={{ marginBottom: 10 }}>
          {checkResult.hardCount > 0 && (
            <span className="warn" style={{ marginRight: 12 }}>
              ⚠ 必須条件の違反 {checkResult.hardCount}件
            </span>
          )}
          {checkResult.softCount > 0 && (
            <span className="muted">推奨条件の未達 {checkResult.softCount}件</span>
          )}
        </p>
      )}

      {(loading || mastersLoading) && <p className="muted no-print">読み込み中…</p>}
      {error && <p className="warn no-print">{error}</p>}
      {!loading && staffList.length === 0 && (
        <p className="muted no-print">有効な職員が登録されていません。</p>
      )}
      {!loading && shiftPatterns.length === 0 && (
        <p className="warn no-print">
          勤務パターンが未登録です。先に「勤務パターン」タブで登録してください。
        </p>
      )}

      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <div className="grid-scroll no-print">
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
                {summaryPatterns.map((p) => (
                  <th key={p.id} className="sumcol">
                    {p.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffList.map((staff) => {
                const staffMsgs = checkResult.staffMessages[staff.id] ?? []
                const staffAssignments = schedule?.assignments?.[staff.id] ?? {}
                return (
                  <tr key={staff.id}>
                    <td className="namecol" title={staffMsgs.join('\n') || undefined}>
                      {staff.name}
                      {staffMsgs.length > 0 && <span className="warn"> ⚠</span>}
                    </td>
                    {dayList.map((d) => {
                      const patternId = staffAssignments[String(d)] ?? ''
                      const locked = schedule?.locks?.[staff.id]?.[String(d)] ?? false
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
                                if (!isAdmin) return
                                setPicker({
                                  staffId: staff.id,
                                  day: d,
                                  rect: e.currentTarget.getBoundingClientRect(),
                                })
                              }}
                            >
                              {pattern?.code ?? ''}
                            </div>
                            {locked && <span className="lock-dot" title="ロック中" />}
                            {cellMsgs.length > 0 && <span className="viol-mark">!</span>}
                          </div>
                        </td>
                      )
                    })}
                    {summaryPatterns.map((p) => {
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {picker &&
        (() => {
          const pickerStaff = staffList.find((s) => s.id === picker.staffId)
          if (!pickerStaff) return null
          const locked = schedule?.locks?.[picker.staffId]?.[String(picker.day)] ?? false
          return (
            <CellPicker
              anchorRect={picker.rect}
              staffName={pickerStaff.name}
              dateLabel={formatMonthDayWeekday(yearMonth, picker.day)}
              options={optionsFor(pickerStaff)}
              current={schedule?.assignments?.[picker.staffId]?.[String(picker.day)] ?? ''}
              locked={locked}
              onPick={(patternId) => {
                void handleAssign(picker.staffId, picker.day, patternId)
                setPicker(null)
              }}
              onClear={() => {
                void handleAssign(picker.staffId, picker.day, '')
                setPicker(null)
              }}
              onToggleLock={() => {
                void handleToggleLock(picker.staffId, picker.day, locked)
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
          )
        })()}

      <p className="muted no-print" style={{ marginTop: 10 }}>
        セルをクリックすると勤務パターンを選択できます。パネル内の「ロック切替」は自動生成（今後のフェーズ）でこのセルを固定する目印です（🔒が付きます）。
        「!」は必須条件・相性・勤務条件などの違反（マウスを乗せると詳細）、金の枠は希望休が守れている日、赤の枠は希望休なのに勤務が入っている日です。
      </p>

      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <PrintableShiftGrid
          facilityName={facilityName}
          yearMonth={yearMonth}
          staffList={staffList}
          schedule={schedule}
          shiftPatterns={shiftPatterns}
        />
      )}
    </section>
  )
}
