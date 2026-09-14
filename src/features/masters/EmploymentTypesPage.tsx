import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteEmploymentType, upsertEmploymentType } from '../../lib/firestore'
import type { EmploymentType } from '../../types/models'

type Row = EmploymentType & { id: string | null }

export default function EmploymentTypesPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { employmentTypes, loading, error, refresh } = useMasters()
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    setRows(employmentTypes.map((e) => ({ ...e })))
  }, [employmentTypes])

  if (!selectedFacilityId) return null

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))
    setSaveMessage(null)
  }

  /** 表示名が入力済みの行をまとめて1回で保存する（未入力の行はスキップ） */
  async function saveAll() {
    const validRows = rows.filter((r) => r.label.trim())
    const skipped = rows.length - validRows.length
    setSaving(true)
    setSaveMessage(null)
    try {
      await Promise.all(
        validRows.map((row) => {
          const { id, ...data } = row
          return upsertEmploymentType(selectedFacilityId!, id, data)
        }),
      )
      await refresh()
      setSaveMessage(skipped > 0 ? `保存しました（表示名が未入力の${skipped}行はスキップしました）` : '保存しました')
    } finally {
      setSaving(false)
    }
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
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button type="button" onClick={addRow}>
            ＋ 雇用区分を追加
          </button>
          <button type="button" onClick={() => void saveAll()} disabled={saving}>
            {saving ? '保存中…' : 'まとめて保存'}
          </button>
          {saveMessage && <span className="ok">{saveMessage}</span>}
        </div>
      )}
    </section>
  )
}
