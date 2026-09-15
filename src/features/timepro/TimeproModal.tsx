import { useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import Toast from '../../components/Toast'
import { formatYearMonthLabel, WEEKDAY_LABELS } from '../../lib/dateUtils'
import type { ShiftPattern, Staff, TimeproPatternMapEntry } from '../../types/models'
import { buildTimeproRows, toClipboardColumn, withDefaults } from './buildTimeproRows'

type StaffWithId = Staff & { id: string }
type ShiftPatternWithId = ShiftPattern & { id: string }

interface Props {
  yearMonth: string
  daysInMonth: number
  staffList: StaffWithId[]
  shiftPatterns: ShiftPatternWithId[]
  assignments: Record<string, Record<string, string>> | undefined
  savedPatternMap: Record<string, TimeproPatternMapEntry>
  isAdmin: boolean
  onSave: (patternMap: Record<string, TimeproPatternMapEntry>) => Promise<void>
  onClose: () => void
}

/**
 * P6: TimePro-VG 貼付用データ。職員別に「勤怠区分」「シフト区分」を1ヶ月分、
 * 改行区切りテキストでクリップボードへコピーする（旧版の copyTimeproColumn を踏襲）。
 */
export default function TimeproModal({
  yearMonth,
  daysInMonth,
  staffList,
  shiftPatterns,
  assignments,
  savedPatternMap,
  isAdmin,
  onSave,
  onClose,
}: Props) {
  const [staffId, setStaffId] = useState(staffList[0]?.id ?? '')
  const [patternMap, setPatternMap] = useState(() => withDefaults(shiftPatterns, savedPatternMap))
  const [mapExpanded, setMapExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const rows = useMemo(
    () => buildTimeproRows(yearMonth, daysInMonth, staffId, assignments, patternMap),
    [yearMonth, daysInMonth, staffId, assignments, patternMap],
  )

  function updateEntry(patternId: string, patch: Partial<TimeproPatternMapEntry>) {
    setPatternMap((prev) => ({ ...prev, [patternId]: { ...prev[patternId], ...patch } }))
  }

  async function handleSaveMap() {
    setSaving(true)
    setError(null)
    try {
      await onSave(patternMap)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleCopy(field: 'kotai' | 'shift') {
    try {
      await navigator.clipboard.writeText(toClipboardColumn(rows, field))
      setToast(field === 'kotai' ? '勤怠区分をコピーしました' : 'シフト区分をコピーしました')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={`${formatYearMonthLabel(yearMonth)} TimePro貼付用`} onClose={onClose}>
      <label className="field-row">
        職員
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          {staffList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <p className="muted" style={{ marginTop: 10 }}>
        <button type="button" className="link-btn" onClick={() => setMapExpanded((v) => !v)}>
          {mapExpanded ? '記号の対応表を閉じる' : '記号の対応表を編集'}
        </button>
      </p>

      {mapExpanded && (
        <div style={{ marginBottom: 14 }}>
          <p className="muted">
            勤務記号ごとに TimePro-VG 側の「勤怠区分」「シフト区分」の表記を調整できます。空欄はその列に何も入力しません。
          </p>
          <table className="master-table">
            <thead>
              <tr>
                <th>記号</th>
                <th>勤怠区分</th>
                <th>シフト区分</th>
              </tr>
            </thead>
            <tbody>
              {shiftPatterns.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>
                    <input
                      value={patternMap[p.id]?.kotai ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => updateEntry(p.id, { kotai: e.target.value })}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <input
                      value={patternMap[p.id]?.shift ?? ''}
                      disabled={!isAdmin}
                      onChange={(e) => updateEntry(p.id, { shift: e.target.value })}
                      style={{ width: 140 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <div className="row" style={{ gap: 10, marginTop: 10 }}>
              <button type="button" onClick={() => void handleSaveMap()} disabled={saving}>
                {saving ? '保存中…' : '対応表を保存'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="warn">{error}</p>}

      <table className="master-table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>処理日</th>
            <th>曜日</th>
            <th>勤怠区分</th>
            <th>シフト区分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td>{r.day}</td>
              <td>{WEEKDAY_LABELS[r.weekday]}</td>
              <td>{r.kotai}</td>
              <td>{r.shift}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ gap: 10, marginTop: 14 }}>
        <button type="button" onClick={() => void handleCopy('kotai')}>
          勤怠区分をコピー
        </button>
        <button type="button" onClick={() => void handleCopy('shift')}>
          シフト区分をコピー
        </button>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </Modal>
  )
}
