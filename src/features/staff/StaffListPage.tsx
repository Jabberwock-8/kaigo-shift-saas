import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteStaff, fetchLeaveRequestsForMonth, fetchStaffList } from '../../lib/firestore'
import type { Staff } from '../../types/models'
import { currentYearMonth } from '../../lib/dateUtils'

export default function StaffListPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { jobTypes, employmentTypes, shiftPatterns } = useMasters()
  const [staff, setStaff] = useState<(Staff & { id: string })[]>([])
  const [wishCounts, setWishCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
