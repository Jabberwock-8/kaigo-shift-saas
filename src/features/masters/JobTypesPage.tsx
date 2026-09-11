import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteJobType, upsertJobType } from '../../lib/firestore'
import type { JobType } from '../../types/models'

type Row = JobType & { id: string | null; saving?: boolean }

export default function JobTypesPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { jobTypes, loading, error, refresh } = useMasters()
  const [rows, setRows] = useState<Row[]>([])
  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    setRows(jobTypes.map((j) => ({ ...j })))
  }, [jobTypes])

  if (!selectedFacilityId) return null

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function saveRow(index: number) {
    const row = rows[index]
    if (!row.label.trim()) return
    updateRow(index, { saving: true })
    const { id, saving: _saving, ...data } = row
    void _saving
    await upsertJobType(selectedFacilityId!, id, data)
    await refresh()
  }

  async function removeRow(index: number) {
    const row = rows[index]
    if (row.id) {
      if (!confirm(`「${row.label}」を削除しますか？`)) return
      await deleteJobType(selectedFacilityId!, row.id)
      await refresh()
    } else {
      setRows((rs) => rs.filter((_, i) => i !== index))
    }
  }

  function addRow() {
    const nextOrder =
      rows.reduce((max, r) => Math.max(max, r.order ?? 0), 0) + 1
    setRows((rs) => [...rs, { id: null, label: '', order: nextOrder }])
  }

  return (
    <section className="card">
      <h2>職種</h2>
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      <table className="master-table">
        <thead>
          <tr>
            <th>表示名</th>
            <th>並び順</th>
            {isAdmin && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? `new-${i}`}>
              <td>
                <input
                  value={row.label}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={row.order ?? 0}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { order: Number(e.target.value) })}
                  style={{ width: 64 }}
                />
              </td>
              {isAdmin && (
                <td className="row-actions">
                  <button type="button" onClick={() => void saveRow(i)} disabled={row.saving}>
                    保存
                  </button>
                  <button type="button" className="ghost" onClick={() => void removeRow(i)}>
                    削除
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin && (
        <button type="button" onClick={addRow} style={{ marginTop: 10 }}>
          ＋ 職種を追加
        </button>
      )}
    </section>
  )
}
