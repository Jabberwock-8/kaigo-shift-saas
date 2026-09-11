import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteStaff, fetchStaffList } from '../../lib/firestore'
import type { Staff } from '../../types/models'

export default function StaffListPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { jobTypes, employmentTypes } = useMasters()
  const [staff, setStaff] = useState<(Staff & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isAdmin = appUser?.role === 'admin'

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      setStaff(await fetchStaffList(selectedFacilityId))
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
  const employmentTypeLabel = (id?: string) =>
    employmentTypes.find((e) => e.id === id)?.label ?? ''

  async function handleDelete(s: Staff & { id: string }) {
    if (!confirm(`「${s.name}」を削除しますか？`)) return
    await deleteStaff(selectedFacilityId!, s.id)
    await load()
  }

  return (
    <section className="card">
      <div className="page-header">
        <h2>職員一覧</h2>
        {isAdmin && <Link to="/staff/new">＋ 職員を追加</Link>}
      </div>

      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      {!loading && !error && staff.length === 0 && (
        <p className="muted">職員が登録されていません。</p>
      )}

      {staff.length > 0 && (
        <table className="master-table">
          <thead>
            <tr>
              <th>氏名</th>
              <th>職種</th>
              <th>雇用区分</th>
              <th>状態</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{jobTypeLabel(s.jobTypeId)}</td>
                <td>{employmentTypeLabel(s.employmentTypeId)}</td>
                <td>{s.active === false ? '無効' : '有効'}</td>
                {isAdmin && (
                  <td className="row-actions">
                    <Link to={`/staff/${s.id}`}>編集</Link>
                    <button type="button" className="ghost" onClick={() => void handleDelete(s)}>
                      削除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
