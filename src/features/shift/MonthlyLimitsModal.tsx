import { useState } from 'react'
import Modal from '../../components/Modal'
import { resolveLimits } from '../../domain/scheduler/limits'
import { formatYearMonthLabel } from '../../lib/dateUtils'
import type { EmploymentType, ShiftRulesSettings, Staff } from '../../types/models'

type StaffWithId = Staff & { id: string }
type EmploymentTypeWithId = EmploymentType & { id: string }

export type MonthlyOverrideMap = Record<
  string,
  { targetWorkdays?: number | null; maxWorkdays?: number | null }
>

interface Props {
  yearMonth: string
  daysInMonth: number
  staffList: StaffWithId[]
  employmentTypes: EmploymentTypeWithId[]
  settings: ShiftRulesSettings
  initialOverride: MonthlyOverrideMap
  onSave: (override: MonthlyOverrideMap) => Promise<void>
  onClose: () => void
}

function toNumberOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * 月ごとに公休数が違うケースに対応する「月の上限を調整」モーダル（P5）。
 * 旧版のUI（1つの上限値・雇用形態/通常列つき一覧・公休数からの一括計算）に合わせている。
 * 一覧には全職員を表示し（雇用区分の設定状態に左右されない）、一括適用のみ常勤を対象とする。
 */
export default function MonthlyLimitsModal({
  yearMonth,
  daysInMonth,
  staffList,
  employmentTypes,
  settings,
  initialOverride,
  onSave,
  onClose,
}: Props) {
  const [override, setOverride] = useState<MonthlyOverrideMap>(initialOverride)
  const [holidayCount, setHolidayCount] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const employmentTypeById = new Map(employmentTypes.map((e) => [e.id, e]))
  // 雇用区分の設定に関係なく全職員を表示する（上限の上書きは誰にでも意味があるため）
  const targetStaff = staffList.filter((s) => s.active !== false)

  function setLimit(staffId: string, value: number | null) {
    setOverride((prev) => ({ ...prev, [staffId]: { targetWorkdays: value, maxWorkdays: value } }))
  }

  // 一括適用は旧版同様「常勤」のみが対象。パート・非常勤などは個別に入力する
  const fullTimeStaff = targetStaff.filter(
    (s) => employmentTypeById.get(s.employmentTypeId ?? '')?.label === '常勤',
  )

  function applyToFullTime() {
    const holidays = toNumberOrNull(holidayCount)
    if (holidays == null) {
      setError('この月の公休数を入力してください。')
      return
    }
    const days = daysInMonth - holidays
    const next: MonthlyOverrideMap = { ...override }
    for (const s of fullTimeStaff) {
      next[s.id] = { targetWorkdays: days, maxWorkdays: days }
    }
    setOverride(next)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(override)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${formatYearMonthLabel(yearMonth)}の勤務日数上限`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 14 }}>
        月によって公休数（休みの日数）が異なる場合、この月だけ職員ごとの上限を変更できます。空欄なら職員情報の通常の上限がそのまま使われます。
      </p>

      <div className="limit-calc-box">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          この月の公休数から一括計算：
          <input
            type="number"
            min={0}
            max={31}
            placeholder="例:9"
            value={holidayCount}
            onChange={(e) => setHolidayCount(e.target.value)}
            style={{ width: 70 }}
          />
          日　（{daysInMonth}日 − 公休数 = 上限）
        </div>
        <button type="button" onClick={applyToFullTime} style={{ marginTop: 10 }}>
          常勤全員に適用
        </button>
        <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
          パート・非常勤などは一括適用の対象外です。下の一覧で個別に入力してください。
        </p>
      </div>

      {error && <p className="warn" style={{ margin: '10px 0' }}>{error}</p>}

      {targetStaff.length > 0 && (
        <table className="master-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>職員</th>
              <th>雇用形態</th>
              <th>通常</th>
              <th>この月の上限</th>
            </tr>
          </thead>
          <tbody>
            {targetStaff.map((s) => {
              const et = employmentTypeById.get(s.employmentTypeId ?? '')
              const normal = resolveLimits(s, et, settings).maxWorkdays
              const current = override[s.id]?.maxWorkdays ?? override[s.id]?.targetWorkdays ?? null
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{et?.label ?? ''}</td>
                  <td>{normal != null ? `${normal}日` : '未設定'}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={31}
                      value={current ?? ''}
                      placeholder="通常のまま"
                      onChange={(e) => setLimit(s.id, toNumberOrNull(e.target.value))}
                      style={{ width: 80 }}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="muted" style={{ marginTop: 10 }}>入力欄を空にすると、その職員は通常の上限に戻ります。</p>
    </Modal>
  )
}
