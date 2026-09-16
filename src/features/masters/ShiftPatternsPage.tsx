import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteShiftPattern, upsertShiftPattern } from '../../lib/firestore'
import type { ShiftCategory, ShiftPattern } from '../../types/models'
import { defaultPairFor, PASTEL_PALETTE } from '../../lib/palette'

type Row = ShiftPattern & { id: string | null }

const CATEGORY_LABELS: Record<ShiftCategory, string> = {
  day: '日勤',
  early: '早出',
  late: '遅出',
  night: '夜勤',
  afterNight: '夜勤明け',
  off: '公休',
  paidLeave: '有給',
  individual: '個別',
}

export default function ShiftPatternsPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns, loading, error, refresh } = useMasters()
  const [rows, setRows] = useState<Row[]>([])
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const isAdmin = appUser?.role === 'admin'

  useEffect(() => {
    setRows(shiftPatterns.map((s) => ({ ...s })))
  }, [shiftPatterns])

  if (!selectedFacilityId) return null

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))
    setSaveMessage(null)
  }

  /** 記号・名称が入力済みの行をまとめて1回で保存する（未入力の行はスキップ） */
  async function saveAll() {
    const validRows = rows.filter((r) => r.code.trim() && r.label.trim())
    const skipped = rows.length - validRows.length
    setSaving(true)
    setSaveMessage(null)
    try {
      await Promise.all(
        validRows.map((row) => {
          const { id, ...data } = row
          return upsertShiftPattern(selectedFacilityId!, id, data)
        }),
      )
      await refresh()
      setSaveMessage(skipped > 0 ? `保存しました（記号・名称が未入力の${skipped}行はスキップしました）` : '保存しました')
    } finally {
      setSaving(false)
    }
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
    const pair = defaultPairFor(rows.length)
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
        color: pair.bg,
        textColor: pair.text,
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
            <th>休憩(h)</th>
            <th>勤務</th>
            <th>夜勤</th>
            <th>種別</th>
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
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  value={row.breakHours ?? ''}
                  disabled={!isAdmin || row.isSystem}
                  placeholder="0"
                  title="中抜け・休憩時間。開始〜終了からこの時間を差し引いた分が実労働時間になります"
                  onChange={(e) =>
                    updateRow(i, {
                      breakHours: e.target.value.trim() === '' ? undefined : Number(e.target.value),
                    })
                  }
                  style={{ width: 56 }}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.isWork}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { isWork: e.target.checked })}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={row.isNight}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { isNight: e.target.checked })}
                />
              </td>
              <td>
                <select
                  value={row.category ?? ''}
                  disabled={!isAdmin}
                  onChange={(e) => updateRow(i, { category: (e.target.value || undefined) as ShiftCategory | undefined })}
                >
                  <option value="">（未設定）</option>
                  {(Object.keys(CATEGORY_LABELS) as ShiftCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <div className="swatch-row">
                  <span
                    className="swatch-preview"
                    style={{ background: row.color ?? '#F1F0EB', color: row.textColor ?? '#22271F' }}
                  >
                    {row.code || '記'}
                  </span>
                  {isAdmin &&
                    PASTEL_PALETTE.map((pair) => (
                      <button
                        key={pair.bg}
                        type="button"
                        className={`swatch${row.color === pair.bg ? ' selected' : ''}`}
                        style={{ background: pair.bg }}
                        title={pair.bg}
                        onClick={() => updateRow(i, { color: pair.bg, textColor: pair.text })}
                      />
                    ))}
                </div>
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
            ＋ 勤務パターンを追加
          </button>
          <button type="button" onClick={() => void saveAll()} disabled={saving}>
            {saving ? '保存中…' : 'まとめて保存'}
          </button>
          {saveMessage && <span className="ok">{saveMessage}</span>}
        </div>
      )}
      <p className="muted" style={{ marginTop: 10 }}>
        「明」「公休」「有給」などシステム固定の記号は、記号・名称・開始/終了時刻を編集できません（職員の勤務可否判定などに使われるため）。
        勤務・夜勤・種別・色は編集できます。「種別」は自動生成や違反チェックが「公休」「夜勤明け」などを特定するために使います。
        「公休」の種別を持つ勤務パターンが1つ必要です（夜勤明けの扱いを「明を使う」にする場合は「夜勤明け」も必要）。
        <strong>「公休」「有給」は通常「勤務」のチェックを外してください</strong>（勤務日数としてカウントされてしまいます）。
      </p>
    </section>
  )
}
