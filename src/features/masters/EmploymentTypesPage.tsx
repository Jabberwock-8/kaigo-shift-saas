import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteEmploymentType, upsertEmploymentType } from '../../lib/firestore'
import type { EmploymentType } from '../../types/models'

type Row = EmploymentType & { id: string | null; saving?: boolean }

export default function EmploymentTypesPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { employmentTypes, loading, error, refresh } = useMasters()
  const [rows, setRows] = useState<Row[]>([])
  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    setRows(employmentTypes.map((e) => ({ ...e })))
  }, [employmentTypes])

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
    await upsertEmploymentType(selectedFacilityId!, id, data)
    await refresh()
  }

  async function removeRow(index: number) {
    const row = rows[index]
    if (row.id) {
      if (!confirm(`「${row.label}」を削除しますか？`)) return
      await deleteEmploymentType(selectedFacilityId!, row.id)
      await refresh()
    } else {
      setRows((rs) => rs.filter((_, i) => i !== index))
    }
  }

  function addRow() {
    const nextOrder =
      rows.reduce((max, r) => Math.max(max, r.order ?? 0), 0) + 1
    setRows((rs) => [
      ...rs,
      { id: null, label: '', order: nextOrder, hasTargetWorkdays: false },
    ])
  }

  return (
    <section className="card">
      <h2>雇用区分</h2>
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      <p className="muted" style={{ marginBottom: 10 }}>
        「必要勤務日数あり」を有効にした区分は、月間の必要勤務日数（下限）のチェック対象になります（常勤など）。
      </p>
      <table className="master-table">
        <thead>
          <tr>
            <th>表示名</th>
            <th>並び順</th>
            <th>必要勤務日数あり</th>
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
              <td>
                <input
                  type="checkbox"
                  checked={row.hasTargetWorkdays ?? false}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    updateRow(i, { hasTargetWorkdays: e.target.checked })
                  }
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
          ＋ 雇用区分を追加
        </button>
      )}
    </section>
  )
}
