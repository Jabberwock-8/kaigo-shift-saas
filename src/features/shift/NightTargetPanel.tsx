import { useState } from 'react'
import type { ShiftPattern, Staff } from '../../types/models'

type StaffWithId = Staff & { id: string }
type PatternWithId = ShiftPattern & { id: string }

interface Props {
  staffList: StaffWithId[]
  shiftPatterns: PatternWithId[]
  assignments: Record<string, Record<string, string>>
  daysInMonth: number
}

/**
 * 夜勤回数の目標対比パネル（P5）。`nightShiftTarget` を設定している職員がいる場合のみ表示する。
 * 実績が目標を超えていれば danger 色、下回っていれば warn 色（旧版と同様）。
 * 場所を取るため既定は折りたたみ（未達・超過の人数だけの1行サマリ）にし、
 * トグルで全員分の一覧を展開する。開閉はアニメーションなしの即時切替。
 */
export default function NightTargetPanel({ staffList, shiftPatterns, assignments, daysInMonth }: Props) {
  const [open, setOpen] = useState(false)
  const nightPatternIds = new Set(shiftPatterns.filter((p) => p.isNight).map((p) => p.id))
  const targets = staffList.filter((s) => s.workConditions?.nightShiftTarget != null)
  if (targets.length === 0) return null

  const rows = targets.map((s) => {
    const target = s.workConditions!.nightShiftTarget!
    let actual = 0
    for (let d = 1; d <= daysInMonth; d++) {
      if (nightPatternIds.has(assignments[s.id]?.[String(d)] ?? '')) actual++
    }
    return { staff: s, target, actual, diff: actual - target }
  })
  const underCount = rows.filter((r) => r.diff < 0).length
  const overCount = rows.filter((r) => r.diff > 0).length

  if (!open) {
    return (
      <div className="night-target-panel no-print">
        <span className="night-target-title">夜勤回数</span>
        <span className="night-target-summary">
          {underCount === 0 && overCount === 0 ? (
            <span className="ok">全員が目標どおり</span>
          ) : (
            <>
              {underCount > 0 && <span className="warn">未達 {underCount}名</span>}
              {underCount > 0 && overCount > 0 && <span>・</span>}
              {overCount > 0 && <span className="danger">超過 {overCount}名</span>}
            </>
          )}
        </span>
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          一覧を表示
        </button>
      </div>
    )
  }

  return (
    <div className="night-target-panel no-print">
      <span className="night-target-title">夜勤回数</span>
      {rows.map(({ staff: s, target, actual, diff }) => {
        const cls = diff > 0 ? 'danger' : diff < 0 ? 'warn' : 'ok'
        return (
          <span key={s.id} className="night-target-item">
            {s.name}: <span className={cls}>{actual}</span> / {target}
            {diff !== 0 && <span className={cls}> ({diff > 0 ? '+' : ''}{diff})</span>}
          </span>
        )
      })}
      <button type="button" className="link-btn" onClick={() => setOpen(false)}>
        閉じる
      </button>
    </div>
  )
}
