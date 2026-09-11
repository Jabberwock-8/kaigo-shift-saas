import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { clearWish, fetchLeaveRequestsForMonth, fetchStaffList, setWish } from '../../lib/firestore'
import type { LeaveRequest, Staff } from '../../types/models'
import {
  currentYearMonth,
  daysInMonth as daysInMonthOf,
  formatYearMonthLabel,
  parseYearMonth,
  shiftYearMonth,
  weekdayOf,
  WEEKDAY_LABELS,
  pad2,
} from '../../lib/dateUtils'

type StaffWithId = Staff & { id: string }

export default function WishesPage() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId } = useFacility()
  const isAdmin = appUser?.role === 'admin'

  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [wishes, setWishes] = useState<Map<string, LeaveRequest & { id: string }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)

  function dateStr(day: number) {
    const { year, month0 } = parseYearMonth(yearMonth)
    return `${year}-${pad2(month0 + 1)}-${pad2(day)}`
  }

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [sl, wl] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchLeaveRequestsForMonth(selectedFacilityId, yearMonth),
      ])
      setStaffList(sl.filter((s) => s.active !== false))
      const map = new Map<string, LeaveRequest & { id: string }>()
      wl.forEach((w) => map.set(`${w.staffId}_${w.date}`, w))
      setWishes(map)
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

  async function handleToggle(staffId: string, day: number) {
    if (!user || !isAdmin) return
    const date = dateStr(day)
    const key = `${staffId}_${date}`
    const wished = wishes.has(key)

    setWishes((prev) => {
      const next = new Map(prev)
      if (wished) next.delete(key)
      else
        next.set(key, {
          id: key,
          staffId,
          yearMonth,
          date,
          type: '希望休',
          desiredPatternId: null,
          priority: 'must',
          status: 'approved',
          createdByUid: user.uid,
        })
      return next
    })

    try {
      if (wished) await clearWish(selectedFacilityId!, staffId, date)
      else await setWish(selectedFacilityId!, staffId, date, yearMonth, user.uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
    }
  }

  return (
    <section className="card">
      <div className="page-header">
        <h2>{formatYearMonthLabel(yearMonth)} の希望休</h2>
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

      {!isAdmin && (
        <p className="muted">閲覧のみです。希望休の入力は管理者が行います。</p>
      )}
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      {!loading && staffList.length === 0 && (
        <p className="muted">有効な職員が登録されていません。</p>
      )}

      {staffList.length > 0 && (
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
              {staffList.map((staff) => (
                <tr key={staff.id}>
                  <td className="namecol">{staff.name}</td>
                  {dayList.map((d) => {
                    const wished = wishes.has(`${staff.id}_${dateStr(d)}`)
                    return (
                      <td
                        key={d}
                        className={`wish-cell ${wished ? 'wished' : ''} ${isAdmin ? 'clickable' : ''}`}
                        onClick={() => void handleToggle(staff.id, d)}
                      >
                        {wished ? '★' : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 10 }}>
        セルをクリックすると希望休のON/OFFを切り替えます。シフト表側での希望休の反映表示は今後のフェーズで対応します。
      </p>
    </section>
  )
}
