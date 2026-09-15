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
 */
export default function NightTargetPanel({ staffList, shiftPatterns, assignments, daysInMonth }: Props) {
  const nightPatternIds = new Set(shiftPatterns.filter((p) => p.isNight).map((p) => p.id))
  const targets = staffList.filter((s) => s.workConditions?.nightShiftTarget != null)
  if (targets.length === 0) return null

  return (
    <div className="night-target-panel no-print">
      <span className="night-target-title">夜勤回数</span>
      {targets.map((s) => {
        const target = s.workConditions!.nightShiftTarget!
        let actual = 0
        for (let d = 1; d <= daysInMonth; d++) {
          if (nightPatternIds.has(assignments[s.id]?.[String(d)] ?? '')) actual++
        }
        const diff = actual - target
        const cls = diff > 0 ? 'danger' : diff < 0 ? 'warn' : 'ok'
        return (
          <span key={s.id} className="night-target-item">
            {s.name}: <span className={cls}>{actual}</span> / {target}
            {diff !== 0 && <span className={cls}> ({diff > 0 ? '+' : ''}{diff})</span>}
          </span>
        )
      })}
    </div>
  )
}
