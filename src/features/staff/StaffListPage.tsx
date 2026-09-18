import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteStaff, fetchLeaveRequestsForMonth, fetchStaffList, updateStaffOrder } from '../../lib/firestore'
import type { Staff } from '../../types/models'
import { currentYearMonth } from '../../lib/dateUtils'

export default function StaffListPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { jobTypes, employmentTypes, shiftPatterns } = useMasters()
  const [staff, setStaff] = useState<(Staff & { id: string })[]>([])
  const [wishCounts, setWishCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [orderEdits, setOrderEdits] = useState<Record<string, number>>({})
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderMessage, setOrderMessage] = useState<string | null>(null)
  const isAdmin = appUser?.role === 'admin'

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [sl, wl] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchLeaveRequestsForMonth(selectedFacilityId, currentYearMonth()),
      ])
      setStaff(sl)
      setOrderEdits({})
      const counts: Record<string, number> = {}
      for (const w of wl) {
        if (w.type !== '希望休') continue
        counts[w.staffId] = (counts[w.staffId] ?? 0) + 1
      }
      setWishCounts(counts)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId])

  if (!selectedFacilityId) return null

  const jobTypeLabel = (id?: string) => jobTypes.find((j) => j.id === id)?.label ?? ''
  const employmentTypeLabel = (id?: string) => employmentTypes.find((e) => e.id === id)?.label ?? ''

  async function handleDelete(s: Staff & { id: string }) {
    if (!confirm(`「${s.name}」を削除しますか？`)) return
    await deleteStaff(selectedFacilityId!, s.id)
    await load()
  }

  /** 並び順は職員に紐づくため、変更すればシフト表・希望休など全ての月・画面に反映される */
  async function saveOrder() {
    const changed = staff.filter((s) => orderEdits[s.id] != null && orderEdits[s.id] !== (s.order ?? 0))
    if (changed.length === 0) {
      setOrderMessage('変更はありません')
      return
    }
    setSavingOrder(true)
    setOrderMessage(null)
    try {
      await Promise.all(changed.map((s) => updateStaffOrder(selectedFacilityId!, s.id, orderEdits[s.id])))
      await load()
      setOrderMessage(`並び順を保存しました（${changed.length}名）`)
    } catch (e) {
      setOrderMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingOrder(false)
    }
  }

  return (
    <section className="card">
      <div className="page-header">
        <h2>職員管理</h2>
        {isAdmin && (
          <Link to="/staff/new" className="header-link-btn">
            ＋ 職員を追加
          </Link>
        )}
      </div>

      {isAdmin && staff.length > 0 && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <span className="muted">
            各カードの「並び順」の数字が小さい順に、シフト表・希望休などすべての画面で表示されます（翌月以降も保持されます）。
          </span>
          <button type="button" onClick={() => void saveOrder()} disabled={savingOrder}>
            {savingOrder ? '保存中…' : '並び順を保存'}
          </button>
          {orderMessage && <span className="ok">{orderMessage}</span>}
        </div>
      )}

      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      {!loading && !error && staff.length === 0 && (
        <p className="muted">職員が登録されていません。</p>
      )}

      {staff.length > 0 && (
        <div className="staff-grid">
          {staff.map((s) => {
            const wc = s.workConditions ?? {}
            const workablePatterns = (wc.workablePatternIds ?? [])
              .map((id) => shiftPatterns.find((p) => p.id === id))
              .filter((p): p is NonNullable<typeof p> => !!p)
            const tags = [...(s.qualifications ?? []), ...(s.traits ?? [])]
            const wishCount = wishCounts[s.id] ?? 0
            const metaText = [
              jobTypeLabel(s.jobTypeId),
              employmentTypeLabel(s.employmentTypeId),
              wc.maxWorkdaysPerMonth != null ? `月${wc.maxWorkdaysPerMonth}日まで` : null,
              wc.maxConsecutiveWorkdays != null ? `連続${wc.maxConsecutiveWorkdays}日まで` : null,
            ]
              .filter(Boolean)
              .join('・')

            return (
              <div key={s.id} className={`staff-card${s.active === false ? ' inactive' : ''}`}>
                <div className="staff-card-head">
                  <span className="staff-avatar">{s.name.slice(0, 1)}</span>
                  <div className="staff-card-title">
                    <div className="staff-name">
                      {s.name}
                      {s.active === false && <span className="muted"> （無効）</span>}
                    </div>
                    {metaText && <div className="staff-meta muted">{metaText}</div>}
                  </div>
                  {isAdmin && (
                    <label className="staff-order-field muted" title="並び順">
                      並び順
                      <input
                        type="number"
                        value={orderEdits[s.id] ?? s.order ?? 0}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setOrderEdits((prev) => ({ ...prev, [s.id]: v }))
                          setOrderMessage(null)
                        }}
                        style={{ width: 56 }}
                      />
                    </label>
                  )}
                  {isAdmin && (
                    <Link to={`/staff/${s.id}`} className="header-link-btn">
                      ✎ 編集
                    </Link>
                  )}
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    className="staff-delete-btn"
                    onClick={() => void handleDelete(s)}
                    title="削除"
                  >
                    🗑
                  </button>
                )}

                {workablePatterns.length > 0 && (
                  <div className="staff-chip-row">
                    {workablePatterns.map((p) => (
                      <span
                        key={p.id}
                        className="chip small"
                        style={{ background: p.color ?? '#F1F0EB', color: p.textColor ?? '#22271F' }}
                      >
                        {p.label}
                      </span>
                    ))}
                  </div>
                )}

                {tags.length > 0 && (
                  <div className="staff-chip-row">
                    {tags.map((t) => (
                      <span key={t} className="tag-chip">
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {wishCount > 0 && <div className="staff-card-footer muted">希望休 {wishCount}件</div>}
                {wc.nightShiftTarget != null && (
                  <div className="staff-card-footer muted">夜勤回数目標 月{wc.nightShiftTarget}回</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
