import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteShiftPattern, upsertShiftPattern } from '../../lib/firestore'
import type { ShiftPattern } from '../../types/models'

type Row = ShiftPattern & { id: string | null; saving?: boolean }

export default function ShiftPatternsPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns, loading, error, refresh } = useMasters()
  const [rows, setRows] = useState<Row[]>([])
  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    setRows(shiftPatterns.map((s) => ({ ...s })))
  }, [shiftPatterns])

  if (!selectedFacilityId) return null

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function saveRow(index: number) {
    const row = rows[index]
    if (!row.code.trim() || !row.label.trim()) return
    updateRow(index, { saving: true })
    const { id, saving: _saving, ...data } = row
    void _saving
    await upsertShiftPattern(selectedFacilityId!, id, data)
    await refresh()
  }

  async function removeRow(index: number) {
    const row = rows[index]
    if (row.id) {
      if (row.isSystem) {
        alert('システム固定の勤務パターンは削除できません。')
        return
      }
      if (!confirm(`「${row.label}」を削除しますか？`)) return
      await deleteShiftPattern(selectedFacilityId!, row.id)
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
      {
        id: null,
        code: '',
        label: '',
        startTime: '',
        endTime: '',
        isWork: true,
        isNight: false,
        order: nextOrder,
        color: '#E7F5FF',
      },
    ])
  }

  return (
    <section className="card">
      <h2>勤務パターン</h2>
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      <table className="master-table">
        <thead>
          <tr>
            <th>記号</th>
            <th>名称</th>
            <th>開始</th>
            <th>終了</th>
            <th>勤務</th>
            <th>夜勤</th>
            <th>色</th>
            {isAdmin && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? `new-${i}`}>
              <td>
                <input
                  value={row.code}
                  disabled={!isAdmin || row.isSystem}
                  onChange={(e) => updateRow(i, { code: e.target.value })}
                  style={{ width: 48 }}
                />
              </td>
              <td>
                <input
                  value={row.label}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={row.startTime ?? ''}
                  disabled={!isAdmin || row.isSystem}
                  onChange={(e) => updateRow(i, { startTime: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="time"
                  value={row.endTime ?? ''}
                  disabled={!isAdmin || row.isSystem}
                  onChange={(e) => updateRow(i, { endTime: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.isWork}
                  disabled={!isAdmin || row.isSystem}
                  onChange={(e) => updateRow(i, { isWork: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.isNight}
                  disabled={!isAdmin || row.isSystem}
                  onChange={(e) => updateRow(i, { isNight: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="color"
                  value={row.color ?? '#E7F5FF'}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { color: e.target.value })}
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
          ＋ 勤務パターンを追加
        </button>
      )}
      <p className="muted" style={{ marginTop: 10 }}>
        「明」「公休」「有給」などシステム固定の記号は、色以外を編集できません（職員の勤務可否判定などに使われるため）。
      </p>
    </section>
  )
}
