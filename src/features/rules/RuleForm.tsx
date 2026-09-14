import { useState } from 'react'
import type {
  Rule,
  RuleCondType,
  RuleDaysType,
  RuleTargetType,
  ShiftPattern,
  Staff,
} from '../../types/models'
import { WEEKDAY_LABELS } from '../../lib/dateUtils'

type PatternWithId = ShiftPattern & { id: string }
type StaffWithId = Staff & { id: string }

interface Props {
  shiftPatterns: PatternWithId[]
  staffList: StaffWithId[]
  nextOrder: number
  onSubmit: (rule: Rule) => Promise<void>
}

const COND_OPTIONS: Record<RuleTargetType, { value: RuleCondType; label: string }[]> = {
  shift: [
    { value: 'atLeast', label: 'N名以上配置' },
    { value: 'exact', label: 'ちょうどN名配置' },
    { value: 'atMost', label: 'N名以下' },
    { value: 'none', label: '配置しない' },
  ],
  qualification: [
    { value: 'atLeast', label: 'N名以上配置' },
    { value: 'exact', label: 'ちょうどN名配置' },
    { value: 'atMost', label: 'N名以下' },
    { value: 'none', label: '配置しない' },
  ],
  trait: [
    { value: 'atLeast', label: 'N名以上配置' },
    { value: 'exact', label: 'ちょうどN名配置' },
    { value: 'atMost', label: 'N名以下' },
    { value: 'none', label: '配置しない' },
  ],
  staff: [
    { value: 'work', label: '必ず勤務させる' },
    { value: 'off', label: '勤務させない' },
    { value: 'preferShift', label: '特定のシフトを優先（推奨向け）' },
  ],
  traitPair: [
    { value: 'together', label: '必ず同一シフトに配置' },
    { value: 'notTogether', label: '同一シフトに入れない' },
  ],
  shiftGroup: [
    { value: 'atLeastGroup', label: 'グループ合計でN名以上' },
    { value: 'notTogetherGroup', label: '同時に配置しない（どちらか一方のみ）' },
  ],
}

const DAYS_LABELS: Record<RuleDaysType, string> = {
  all: '毎日',
  weekdays: '平日',
  weekend: '土日',
  dow: '曜日指定',
  dates: '日付指定',
}

const TARGET_LABELS: Record<RuleTargetType, string> = {
  shift: 'シフト種別',
  qualification: '資格',
  trait: '特性タグ',
  staff: '特定職員',
  traitPair: 'タグのペア',
  shiftGroup: 'シフトの組み合わせ',
}

export default function RuleForm({ shiftPatterns, staffList, nextOrder, onSubmit }: Props) {
  const [daysType, setDaysType] = useState<RuleDaysType>('all')
  const [dow, setDow] = useState<number[]>([])
  const [datesText, setDatesText] = useState('')

  const [targetType, setTargetType] = useState<RuleTargetType>('shift')
  const [targetShiftId, setTargetShiftId] = useState('')
  const [targetQualification, setTargetQualification] = useState('')
  const [targetTrait, setTargetTrait] = useState('')
  const [targetStaffId, setTargetStaffId] = useState('')
  const [targetPairA, setTargetPairA] = useState('')
  const [targetPairB, setTargetPairB] = useState('')
  const [targetGroupIds, setTargetGroupIds] = useState<string[]>([])

  const [condType, setCondType] = useState<RuleCondType>('atLeast')
  const [condCount, setCondCount] = useState(1)
  const [condPreferShiftId, setCondPreferShiftId] = useState('')

  const [kind, setKind] = useState<'hard' | 'soft'>('hard')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const qualificationSuggestions = [
    ...new Set(staffList.flatMap((s) => s.qualifications ?? [])),
  ]
  const traitSuggestions = [...new Set(staffList.flatMap((s) => s.traits ?? []))]

  function changeTargetType(t: RuleTargetType) {
    setTargetType(t)
    setCondType(COND_OPTIONS[t][0].value)
  }

  async function handleSubmit() {
    setError(null)

    const days: Rule['days'] =
      daysType === 'dow'
        ? { type: 'dow', values: dow }
        : daysType === 'dates'
          ? {
              type: 'dates',
              values: datesText
                .split(/[,、，]/)
                .map((s) => s.trim())
                .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
            }
          : { type: daysType }
    if (daysType === 'dow' && dow.length === 0) {
      setError('曜日を選択してください')
      return
    }
    if (daysType === 'dates' && (days.values ?? []).length === 0) {
      setError('日付を YYYY-MM-DD 形式で入力してください')
      return
    }

    let target: Rule['target']
    if (targetType === 'shift') {
      if (!targetShiftId) return setError('シフト種別を選択してください')
      target = { type: 'shift', value: targetShiftId }
    } else if (targetType === 'qualification') {
      if (!targetQualification.trim()) return setError('資格名を入力してください')
      target = { type: 'qualification', value: targetQualification.trim() }
    } else if (targetType === 'trait') {
      if (!targetTrait.trim()) return setError('タグ名を入力してください')
      target = { type: 'trait', value: targetTrait.trim() }
    } else if (targetType === 'staff') {
      if (!targetStaffId) return setError('職員を選択してください')
      target = { type: 'staff', value: targetStaffId }
    } else if (targetType === 'traitPair') {
      if (!targetPairA.trim() || !targetPairB.trim()) return setError('タグを2つ入力してください')
      target = { type: 'traitPair', value: targetPairA.trim(), value2: targetPairB.trim() }
    } else {
      if (targetGroupIds.length < 2) return setError('シフトを2つ以上選択してください')
      target = { type: 'shiftGroup', value: targetGroupIds }
    }

    let cond: Rule['cond']
    if (condType === 'atLeast' || condType === 'exact' || condType === 'atMost' || condType === 'atLeastGroup') {
      cond = { type: condType, count: Math.max(0, condCount) }
    } else if (condType === 'preferShift') {
      if (!condPreferShiftId) return setError('優先するシフトを選択してください')
      cond = { type: 'preferShift', value: condPreferShiftId }
    } else {
      cond = { type: condType }
    }

    setSaving(true)
    try {
      await onSubmit({ enabled: true, kind, days, target, cond, order: nextOrder })
      // 送信後はフォームを初期状態に戻す
      setDaysType('all')
      setDow([])
      setDatesText('')
      setTargetType('shift')
      setTargetShiftId('')
      setTargetQualification('')
      setTargetTrait('')
      setTargetStaffId('')
      setTargetPairA('')
      setTargetPairB('')
      setTargetGroupIds([])
      setCondType('atLeast')
      setCondCount(1)
      setCondPreferShiftId('')
      setKind('hard')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const condOptions = COND_OPTIONS[targetType]
  const workPatterns = shiftPatterns.filter((p) => p.isWork)

  return (
    <div className="rule-form">
      <div className="rule-form-row">
        <label>
          対象日
          <select value={daysType} onChange={(e) => setDaysType(e.target.value as RuleDaysType)}>
            {(Object.keys(DAYS_LABELS) as RuleDaysType[]).map((k) => (
              <option key={k} value={k}>
                {DAYS_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        {daysType === 'dow' && (
          <div className="checkbox-inline">
            {WEEKDAY_LABELS.map((label, i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={dow.includes(i)}
                  onChange={(e) =>
                    setDow((d) => (e.target.checked ? [...d, i] : d.filter((x) => x !== i)))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        )}
        {daysType === 'dates' && (
          <input
            value={datesText}
            onChange={(e) => setDatesText(e.target.value)}
            placeholder="2026-09-15, 2026-09-16"
            style={{ width: 220 }}
          />
        )}
      </div>

      <div className="rule-form-row">
        <label>
          対象
          <select
            value={targetType}
            onChange={(e) => changeTargetType(e.target.value as RuleTargetType)}
          >
            {(Object.keys(TARGET_LABELS) as RuleTargetType[]).map((k) => (
              <option key={k} value={k}>
                {TARGET_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        {targetType === 'shift' && (
          <select value={targetShiftId} onChange={(e) => setTargetShiftId(e.target.value)}>
            <option value="">（選択）</option>
            {shiftPatterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {targetType === 'qualification' && (
          <>
            <input
              list="qual-suggestions"
              value={targetQualification}
              onChange={(e) => setTargetQualification(e.target.value)}
              style={{ width: 160 }}
            />
            <datalist id="qual-suggestions">
              {qualificationSuggestions.map((q) => (
                <option key={q} value={q} />
              ))}
            </datalist>
          </>
        )}
        {targetType === 'trait' && (
          <>
            <input
              list="trait-suggestions"
              value={targetTrait}
              onChange={(e) => setTargetTrait(e.target.value)}
              style={{ width: 160 }}
            />
            <datalist id="trait-suggestions">
              {traitSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </>
        )}
        {targetType === 'staff' && (
          <select value={targetStaffId} onChange={(e) => setTargetStaffId(e.target.value)}>
            <option value="">（選択）</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {targetType === 'traitPair' && (
          <>
            <input
              list="trait-suggestions"
              value={targetPairA}
              onChange={(e) => setTargetPairA(e.target.value)}
              placeholder="タグA"
              style={{ width: 120 }}
            />
            <span>と</span>
            <input
              list="trait-suggestions"
              value={targetPairB}
              onChange={(e) => setTargetPairB(e.target.value)}
              placeholder="タグB"
              style={{ width: 120 }}
            />
            <datalist id="trait-suggestions">
              {traitSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </>
        )}
        {targetType === 'shiftGroup' && (
          <div className="checkbox-inline">
            {workPatterns.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={targetGroupIds.includes(p.id)}
                  onChange={(e) =>
                    setTargetGroupIds((g) =>
                      e.target.checked ? [...g, p.id] : g.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.code}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="rule-form-row">
        <label>
          条件
          <select value={condType} onChange={(e) => setCondType(e.target.value as RuleCondType)}>
            {condOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {(condType === 'atLeast' ||
          condType === 'exact' ||
          condType === 'atMost' ||
          condType === 'atLeastGroup') && (
          <>
            <input
              type="number"
              min={0}
              max={20}
              value={condCount}
              onChange={(e) => setCondCount(Number(e.target.value))}
              style={{ width: 60 }}
            />
            名
          </>
        )}
        {condType === 'preferShift' && (
          <select
            value={condPreferShiftId}
            onChange={(e) => setCondPreferShiftId(e.target.value)}
          >
            <option value="">（選択）</option>
            {shiftPatterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}

        <label>
          強さ
          <select value={kind} onChange={(e) => setKind(e.target.value as 'hard' | 'soft')}>
            <option value="hard">必須</option>
            <option value="soft">推奨</option>
          </select>
        </label>

        <button type="button" onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? '追加中…' : '追加'}
        </button>
      </div>

      {error && <p className="warn">{error}</p>}
    </div>
  )
}
