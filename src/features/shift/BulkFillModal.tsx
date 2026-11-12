import { useMemo, useState } from 'react'
import Modal from '../../components/Modal'
import { WEEKDAY_LABELS, formatYearMonthLabel } from '../../lib/dateUtils'
import type { ShiftPattern, Staff } from '../../types/models'
import { planBulkFill, type BulkWeekdayMode } from './bulkFill'

type StaffWithId = Staff & { id: string }
type PatternWithId = ShiftPattern & { id: string }

interface Props {
  yearMonth: string
  daysInMonth: number
  /** シフト表に出ている職員（無効の職員は選べないようにここで除く） */
  staffList: StaffWithId[]
  shiftPatterns: PatternWithId[]
  assignments: Record<string, Record<string, string>> | undefined
  locks: Record<string, Record<string, boolean>> | undefined
  wishes: { staffId: string; date: string; status?: string }[]
  /** その職員がセルで選べる勤務パターン（シフト表のセル選択と同じ） */
  optionsFor: (staff: StaffWithId) => PatternWithId[]
  /** 入れるマスを渡して保存する。実際に入れたマスの数を返す */
  onRun: (cells: { staffId: string; day: number }[], patternId: string) => Promise<number>
  onClose: () => void
}

/**
 * まとめて入力（C1。remaining-work-design.md §19）。
 * 職員・曜日・期間・勤務パターンを選び、空いているマスだけに入れる。実行前に件数と飛ばす内訳を見せる
 */
export default function BulkFillModal({
  yearMonth,
  daysInMonth,
  staffList,
  shiftPatterns,
  assignments,
  locks,
  wishes,
  optionsFor,
  onRun,
  onClose,
}: Props) {
  const targets = useMemo(() => staffList.filter((s) => s.active !== false), [staffList])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<BulkWeekdayMode>('weekdays')
  const [customWeekdays, setCustomWeekdays] = useState<number[]>([])
  const [fromDay, setFromDay] = useState(1)
  const [toDay, setToDay] = useState(daysInMonth)
  const [patternId, setPatternId] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const staffById = useMemo(() => new Map(targets.map((s) => [s.id, s])), [targets])
  const plan = useMemo(
    () =>
      planBulkFill(
        { yearMonth, daysInMonth, staffIds: [...selected], patternId, mode, customWeekdays, fromDay, toDay },
        {
          assignments,
          locks,
          wishes,
          canUsePattern: (id) => {
            const s = staffById.get(id)
            return !!s && optionsFor(s).some((p) => p.id === patternId)
          },
        },
      ),
    [yearMonth, daysInMonth, selected, patternId, mode, customWeekdays, fromDay, toDay, assignments, locks, wishes, staffById, optionsFor],
  )
  const pattern = shiftPatterns.find((p) => p.id === patternId)
  const ready = selected.size > 0 && !!patternId && plan.cells.length > 0
  const { filled, locked, wish, notAllowed } = plan.skipped
  const skippedText = [
    filled && `入力済み ${filled}`,
    locked && `ロック済み ${locked}`,
    wish && `希望のある日 ${wish}`,
    notAllowed && `その職員が選べない勤務 ${notAllowed}`,
  ]
    .filter(Boolean)
    .join('・')

  function toggleStaff(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleRun() {
    if (!ready) return
    setRunning(true)
    setError(null)
    try {
      await onRun(plan.cells, patternId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRunning(false)
    }
  }

  return (
    <Modal
      title={`${formatYearMonthLabel(yearMonth)}のまとめて入力`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ghost" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={() => void handleRun()} disabled={!ready || running}>
            {running ? '入力中…' : ready ? `${plan.cells.length}マスに入れる` : '入れる'}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        選んだ職員の<strong>空いているマスだけ</strong>に、同じ勤務を入れます。入力済み・ロック済み・希望（希望休・有給希望・勤務希望）のある日は変えません。
      </p>

      <div className="bulk-fill-section">
        <div className="bulk-fill-label">
          職員（{selected.size}名）
          <button
            type="button"
            className="link-btn"
            onClick={() => setSelected(new Set(targets.filter((s) => s.excludeFromGeneration).map((s) => s.id)))}
          >
            シフト作成の対象外を全部選ぶ
          </button>
          <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
            選択を外す
          </button>
        </div>
        <div className="bulk-fill-staff">
          {targets.map((s) => (
            <label key={s.id} className="row">
              <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => toggleStaff(s.id, e.target.checked)} />
              {s.name}
              {s.excludeFromGeneration && <span className="muted">（対象外）</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="bulk-fill-section">
        <div className="bulk-fill-label">曜日</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
          {(
            [
              ['weekdays', '平日（月〜金）'],
              ['weekend', '土日'],
              ['custom', '曜日を指定'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="row">
              <input type="radio" name="bulk-mode" checked={mode === value} onChange={() => setMode(value)} />
              {label}
            </label>
          ))}
        </div>
        {mode === 'custom' && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            {WEEKDAY_LABELS.map((label, w) => (
              <label key={w} className="row">
                <input
                  type="checkbox"
                  checked={customWeekdays.includes(w)}
                  onChange={(e) =>
                    setCustomWeekdays((prev) => (e.target.checked ? [...prev, w] : prev.filter((x) => x !== w)))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}
        <p className="muted" style={{ margin: '4px 0 0' }}>祝日は区別しません（平日に含まれます）。祝日の分は、あとでマスを直してください。</p>
      </div>

      <div className="bulk-fill-section">
        <div className="bulk-fill-label">期間</div>
        <div className="row">
          <input
            type="number"
            min={1}
            max={daysInMonth}
            value={fromDay}
            onChange={(e) => setFromDay(Number(e.target.value) || 1)}
            style={{ width: 70 }}
          />
          日 〜
          <input
            type="number"
            min={1}
            max={daysInMonth}
            value={toDay}
            onChange={(e) => setToDay(Number(e.target.value) || daysInMonth)}
            style={{ width: 70 }}
          />
          日
        </div>
      </div>

      <div className="bulk-fill-section">
        <label className="bulk-fill-label" htmlFor="bulk-fill-pattern">
          勤務パターン
        </label>
        <select id="bulk-fill-pattern" value={patternId} onChange={(e) => setPatternId(e.target.value)}>
          <option value="">選んでください</option>
          {shiftPatterns.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code}（{p.label}）
            </option>
          ))}
        </select>
      </div>

      <div className="bulk-fill-summary">
        {selected.size === 0 || !patternId ? (
          <span className="muted">職員と勤務パターンを選ぶと、入れるマスの数が出ます。</span>
        ) : (
          <>
            <strong>
              {plan.staffCount}名・{plan.cells.length}マスに「{pattern?.code}」を入れます。
            </strong>
            {skippedText && <div className="muted">飛ばすマス: {skippedText}</div>}
          </>
        )}
      </div>

      {error && <p className="warn" style={{ marginTop: 10 }}>{error}</p>}
    </Modal>
  )
}
