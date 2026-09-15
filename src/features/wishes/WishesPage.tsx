import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import {
  DEFAULT_SHIFT_RULES_SETTINGS,
  clearWish,
  fetchLeaveRequestsForMonth,
  fetchShiftRulesSettings,
  fetchStaffList,
  setWish,
} from '../../lib/firestore'
import type { LeaveRequest, ShiftRulesSettings, Staff } from '../../types/models'
import {
  currentYearMonth,
  daysInMonth as daysInMonthOf,
  formatDate,
  formatYearMonthLabel,
  shiftYearMonth,
  weekdayOf,
  WEEKDAY_LABELS,
} from '../../lib/dateUtils'

type StaffWithId = Staff & { id: string }

export default function WishesPage() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId } = useFacility()
  const isAdmin = appUser?.role === 'admin'

  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [wishes, setWishes] = useState<Map<string, LeaveRequest & { id: string }>>(new Map())
  const [settings, setSettings] = useState<ShiftRulesSettings>(DEFAULT_SHIFT_RULES_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)

  function dateStr(day: number) {
    return formatDate(yearMonth, day)
  }

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [sl, wl, st] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchLeaveRequestsForMonth(selectedFacilityId, yearMonth),
        fetchShiftRulesSettings(selectedFacilityId),
      ])
      setStaffList(sl.filter((s) => s.active !== false))
      const map = new Map<string, LeaveRequest & { id: string }>()
      wl.forEach((w) => map.set(`${w.staffId}_${w.date}`, w))
      setWishes(map)
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

  if (!selectedFacilityId) return null

  function wishCountFor(staffId: string): number {
    let count = 0
    wishes.forEach((w) => {
      if (w.staffId === staffId) count++
    })
    return count
  }

  async function handleToggle(staffId: string, day: number) {
    if (!user || !isAdmin) return
    const date = dateStr(day)
    const key = `${staffId}_${date}`
    const wished = wishes.has(key)

    if (!wished && settings.maxWishesPerMonth != null && wishCountFor(staffId) >= settings.maxWishesPerMonth) {
      const name = staffList.find((s) => s.id === staffId)?.name ?? 'この職員'
      setError(
        `${name}さんは希望休の上限（月${settings.maxWishesPerMonth}日）に達しています。追加するには、先にどこかの希望休を外してください。`,
      )
      return
    }
    setError(null)

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
              {staffList.map((staff) => {
                const count = wishCountFor(staff.id)
                const overLimit = settings.maxWishesPerMonth != null && count >= settings.maxWishesPerMonth
                return (
                <tr key={staff.id}>
                  <td className="namecol">
                    {staff.name}
                    {settings.maxWishesPerMonth != null && (
                      <span className={overLimit ? 'warn' : 'muted'} style={{ fontSize: '0.75rem', display: 'block' }}>
                        {count} / {settings.maxWishesPerMonth}
                      </span>
                    )}
                  </td>
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
                )
              })}
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
