import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { fetchStaffList } from '../../lib/firestore'
import type { Staff } from '../../types/models'

export default function StaffListPage() {
  const { signOut } = useAuth()
  const { facilities, selectedFacilityId, selectFacility } = useFacility()
  const [staff, setStaff] = useState<(Staff & { id: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const facility = facilities.find((f) => f.id === selectedFacilityId)

  useEffect(() => {
    if (!selectedFacilityId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchStaffList(selectedFacilityId)
      .then((list) => {
        if (!cancelled) setStaff(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFacilityId])

  return (
    <main className="app-shell">
      <div className="page-header">
        <h1>{facility ? facility.name : '職員一覧'}</h1>
        <div className="header-actions">
          {facilities.length > 1 && (
            <button type="button" onClick={() => selectFacility('')}>
              施設を変更
            </button>
          )}
          <button type="button" onClick={() => void signOut()}>
            ログアウト
          </button>
        </div>
      </div>

      <section className="card">
        <h2>職員一覧</h2>
        {loading && <p className="muted">読み込み中…</p>}
        {error && <p className="warn">{error}</p>}
        {!loading && !error && staff.length === 0 && (
          <p className="muted">職員が登録されていません。</p>
        )}
        {staff.length > 0 && (
          <ul className="list-plain">
            {staff.map((s) => (
              <li key={s.id}>
                {s.name}
                {s.active === false && <span className="muted"> （無効）</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
