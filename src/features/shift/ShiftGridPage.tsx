import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { fetchSchedule, fetchStaffList, setAssignment, setLock } from '../../lib/firestore'
import type { Schedule, Staff } from '../../types/models'
import {
  currentYearMonth,
  daysInMonth as daysInMonthOf,
  formatYearMonthLabel,
  shiftYearMonth,
  weekdayOf,
  WEEKDAY_LABELS,
} from '../../lib/dateUtils'

type StaffWithId = Staff & { id: string }

export default function ShiftGridPage() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns, loading: mastersLoading } = useMasters()
  const isAdmin = appUser?.role === 'admin'

  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [sl, sc] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchSchedule(selectedFacilityId, yearMonth),
      ])
      setStaffList(sl.filter((s) => s.active !== false))
      setSchedule(sc)
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

  if (!selectedFacilityId) return null

  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))

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
      <div className="page-header">
        <h2>{formatYearMonthLabel(yearMonth)} のシフト表</h2>
        <div className="header-actions">
          <button type="button" onClick={() => setYearMonth((ym) => shiftYearMonth(ym, -1))}>
            ◀
          </button>
          <button type="button" onClick={() => setYearMonth(currentYearMonth())}>
            今月
          </button>
          <button type="button" onClick={() => setYearMonth((ym) => shiftYearMonth(ym, 1))}>
            ▶
          </button>
        </div>
      </div>

      {(loading || mastersLoading) && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      {!loading && staffList.length === 0 && (
        <p className="muted">有効な職員が登録されていません。</p>
      )}
      {!loading && shiftPatterns.length === 0 && (
        <p className="warn">
          勤務パターンが未登録です。先に「勤務パターン」タブで登録してください。
        </p>
      )}

      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <div className="grid-scroll">
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
              {staffList.map((staff) => {
                const options = optionsFor(staff)
                return (
                  <tr key={staff.id}>
                    <td className="namecol">{staff.name}</td>
                    {dayList.map((d) => {
                      const patternId = schedule?.assignments?.[staff.id]?.[String(d)] ?? ''
                      const locked = schedule?.locks?.[staff.id]?.[String(d)] ?? false
                      const pattern = patternById.get(patternId)
                      return (
                        <td key={d} className="grid-cell">
                          <div className="cell-wrap">
                            <select
                              value={patternId}
                              disabled={!isAdmin}
                              style={pattern?.color ? { backgroundColor: pattern.color } : undefined}
                              onChange={(e) => void handleAssign(staff.id, d, e.target.value)}
                            >
                              <option value=""></option>
                              {options.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.code}
                                </option>
                              ))}
                            </select>
                            {isAdmin && (
                              <button
                                type="button"
                                className={`lock-btn ${locked ? 'locked' : ''}`}
                                title="ロック切替"
                                onClick={() => void handleToggleLock(staff.id, d, locked)}
                              >
                                {locked ? '🔒' : '🔓'}
                              </button>
                            )}
                          </div>
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

      <p className="muted" style={{ marginTop: 10 }}>
        セルをクリックして勤務パターンを選択できます。🔒は自動生成（今後のフェーズ）でこのセルを固定する目印です。
      </p>
    </section>
  )
}
