import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { fetchSchedulesForMonths, fetchStaffList, updateStaffPaidLeave } from '../../lib/firestore'
import { currentYearMonth, formatYearMonthLabel, shiftYearMonth } from '../../lib/dateUtils'
import type { PaidLeaveInfo, Staff } from '../../types/models'
import { calcPaidLeaveBalance, yearMonthRange } from './calcPaidLeave'

type StaffWithId = Staff & { id: string }

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

function toNumberOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * 有給休暇の残日数一覧。職員ごとに「基準年月時点の残日数」「毎年の付与月・付与日数」を設定すると、
 * 基準年月の翌月から表示対象月までの、勤務パターンcategory='paidLeave'の消化日数を自動で積算して
 * 残日数を計算する（calcPaidLeave.ts）。有給希望の入力画面は無く、シフト表で「有給」を割り当てた
 * 実績をそのまま消化日数として扱う。
 */
export default function PaidLeavePage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns } = useMasters()
  const isAdmin = appUser?.role === 'admin'

  const [asOf, setAsOf] = useState(currentYearMonth())
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [usedByStaffMonth, setUsedByStaffMonth] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [edits, setEdits] = useState<Record<string, PaidLeaveInfo>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const paidLeavePatternIds = new Set(shiftPatterns.filter((p) => p.category === 'paidLeave').map((p) => p.id))

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const sl = await fetchStaffList(selectedFacilityId)
      const active = sl.filter((s) => s.active !== false)
      setStaffList(active)
      setEdits(Object.fromEntries(active.map((s) => [s.id, s.paidLeave ?? {}])))

      const baselines = active.map((s) => s.paidLeave?.baselineYearMonth).filter((v): v is string => !!v)
      if (baselines.length > 0 && paidLeavePatternIds.size > 0) {
        const earliest = baselines.reduce((min, v) => (v < min ? v : min), baselines[0])
        const from = earliest < asOf ? shiftYearMonth(earliest, 1) : asOf
        const months = yearMonthRange(from, asOf)
        const schedules = await fetchSchedulesForMonths(selectedFacilityId, months)
        const used: Record<string, Record<string, number>> = {}
        for (const ym of months) {
          const assignments = schedules[ym]?.assignments ?? {}
          for (const staff of active) {
            const byDay = assignments[staff.id] ?? {}
            const count = Object.values(byDay).filter((pid) => paidLeavePatternIds.has(pid)).length
            if (!used[staff.id]) used[staff.id] = {}
            used[staff.id][ym] = count
          }
        }
        setUsedByStaffMonth(used)
      } else {
        setUsedByStaffMonth({})
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId, asOf, shiftPatterns.length])

  if (!selectedFacilityId) return null

  function updateEdit(staffId: string, patch: Partial<PaidLeaveInfo>) {
    setEdits((prev) => ({ ...prev, [staffId]: { ...prev[staffId], ...patch } }))
  }

  async function saveRow(staffId: string) {
    if (!selectedFacilityId) return
    setSavingId(staffId)
    setError(null)
    try {
      await updateStaffPaidLeave(selectedFacilityId, staffId, edits[staffId] ?? {})
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="card">
      <div className="page-header">
        <h2>有給休暇</h2>
        <div className="header-actions">
          <button type="button" onClick={() => setAsOf((ym) => shiftYearMonth(ym, -1))}>
            ◀
          </button>
          <button type="button" onClick={() => setAsOf(currentYearMonth())}>
            今月
          </button>
          <button type="button" onClick={() => setAsOf((ym) => shiftYearMonth(ym, 1))}>
            ▶
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 14 }}>
        {formatYearMonthLabel(asOf)}時点の残日数です。「基準年月」の残日数を起点に、以後の付与と、シフト表で「有給」を割り当てた日数を自動で積み上げて計算します。
        「有給」カテゴリの勤務パターンが登録されていない場合、消化日数は計算できません。
      </p>

      {paidLeavePatternIds.size === 0 && (
        <p className="warn" style={{ marginBottom: 14 }}>
          「有給」カテゴリの勤務パターンが見つかりません。「勤務パターン」画面で該当する記号の種別を「有給」に設定してください。
        </p>
      )}
      {error && <p className="warn">{error}</p>}
      {loading && <p className="muted">読み込み中…</p>}
      {!loading && staffList.length === 0 && <p className="muted">有効な職員が登録されていません。</p>}

      {staffList.length > 0 && (
        <table className="master-table">
          <thead>
            <tr>
              <th>職員</th>
              <th>付与月</th>
              <th>付与日数</th>
              <th>基準年月</th>
              <th>基準残日数</th>
              <th>消化日数（基準以降）</th>
              <th>{formatYearMonthLabel(asOf)}時点の残日数</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {staffList.map((s) => {
              const edit = edits[s.id] ?? {}
              const usedTotal = Object.values(usedByStaffMonth[s.id] ?? {}).reduce((a, b) => a + b, 0)
              const balance = calcPaidLeaveBalance(s.paidLeave, asOf, usedByStaffMonth[s.id] ?? {})
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    <select
                      value={edit.grantMonth ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => updateEdit(s.id, { grantMonth: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">未設定</option>
                      {MONTH_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}月
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={edit.grantDays ?? ''}
                      disabled={!isAdmin}
                      placeholder="未設定"
                      onChange={(e) => updateEdit(s.id, { grantDays: toNumberOrNull(e.target.value) })}
                      style={{ width: 64 }}
                    />
                  </td>
                  <td>
                    <input
                      type="month"
                      value={edit.baselineYearMonth ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => updateEdit(s.id, { baselineYearMonth: e.target.value || null })}
                      style={{ width: 140 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={edit.baselineDays ?? ''}
                      disabled={!isAdmin}
                      placeholder="未設定"
                      onChange={(e) => updateEdit(s.id, { baselineDays: toNumberOrNull(e.target.value) })}
                      style={{ width: 64 }}
                    />
                  </td>
                  <td>{s.paidLeave?.baselineYearMonth ? `${usedTotal}日` : '—'}</td>
                  <td>
                    <strong>{balance != null ? `${balance}日` : '—'}</strong>
                  </td>
                  {isAdmin && (
                    <td>
                      <button type="button" onClick={() => void saveRow(s.id)} disabled={savingId === s.id}>
                        {savingId === s.id ? '保存中…' : '保存'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
