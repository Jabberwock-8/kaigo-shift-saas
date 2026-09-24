import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { fetchStaff, upsertStaff } from '../../lib/firestore'
import { staffJobTypeIds } from '../../lib/staffUtils'
import { employmentTypeUsesTargetWorkdays } from '../../domain/scheduler/limits'
import type { Staff, StaffWorkConditions } from '../../types/models'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

const emptyStaff: Staff = {
  name: '',
  nameKana: '',
  jobTypeIds: [],
  position: '',
  employmentTypeId: '',
  active: true,
  qualifications: [],
  workConditions: {},
}

function toNumberOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export default function StaffFormPage() {
  const { staffId } = useParams()
  const isNew = !staffId || staffId === 'new'
  const navigate = useNavigate()
  const { selectedFacilityId } = useFacility()
  const { jobTypes, employmentTypes, shiftPatterns, loading: mastersLoading } = useMasters()

  const [form, setForm] = useState<Staff>(emptyStaff)
  const [qualificationsText, setQualificationsText] = useState('')
  const [traitsText, setTraitsText] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedJobTypeIds = staffJobTypeIds(form)
  const selectedEmploymentType = employmentTypes.find((e) => e.id === form.employmentTypeId)
  // 下限を入れても雇用区分側で無効だと黙って無視される（非常勤が月5日しか入らなかった原因）。入力した時点で知らせる
  const targetWorkdaysIgnored =
    form.workConditions?.targetWorkdaysPerMonth != null &&
    !employmentTypeUsesTargetWorkdays(selectedEmploymentType)

  useEffect(() => {
    if (isNew || !selectedFacilityId || !staffId) return
    setLoading(true)
    fetchStaff(selectedFacilityId, staffId)
      .then((s) => {
        if (s) {
          setForm(s)
          setQualificationsText((s.qualifications ?? []).join(', '))
          setTraitsText((s.traits ?? []).join(', '))
        }
      })
      .finally(() => setLoading(false))
  }, [isNew, selectedFacilityId, staffId])

  if (!selectedFacilityId) return null
  if (loading || mastersLoading) return <p className="muted">読み込み中…</p>

  const wc: StaffWorkConditions = form.workConditions ?? {}
  const traitsList = traitsText
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean)

  function updateForm(patch: Partial<Staff>) {
    setForm((f) => ({ ...f, ...patch }))
  }

  function toggleTrait(trait: string, checked: boolean) {
    const others = traitsList.filter((t) => t !== trait)
    setTraitsText((checked ? [...others, trait] : others).join(', '))
  }

  const otherTraitsText = traitsList.filter((t) => t !== '生活相談員').join(', ')

  function setOtherTraitsText(value: string) {
    const others = value
      .split(/[,、，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    setTraitsText((traitsList.includes('生活相談員') ? [...others, '生活相談員'] : others).join(', '))
  }

  function updateWorkConditions(patch: Partial<StaffWorkConditions>) {
    setForm((f) => ({ ...f, workConditions: { ...(f.workConditions ?? {}), ...patch } }))
  }

  function toggleJobType(jobTypeId: string, checked: boolean) {
    const cur = new Set(staffJobTypeIds(form))
    if (checked) cur.add(jobTypeId)
    else cur.delete(jobTypeId)
    updateForm({ jobTypeIds: [...cur] })
  }

  function toggleWorkablePattern(patternId: string, checked: boolean) {
    const cur = new Set(wc.workablePatternIds ?? [])
    if (checked) cur.add(patternId)
    else cur.delete(patternId)
    updateWorkConditions({ workablePatternIds: [...cur] })
  }

  function toggleFixedOffWeekday(dow: number, checked: boolean) {
    const cur = new Set(wc.fixedOffWeekdays ?? [])
    if (checked) cur.add(dow)
    else cur.delete(dow)
    updateWorkConditions({ fixedOffWeekdays: [...cur].sort() })
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const data: Staff = {
        ...form,
        jobTypeIds: selectedJobTypeIds,
        // 旧・単数の職種は空にする。残すと以後の読み取りで復活し得るため
        jobTypeId: '',
        qualifications: qualificationsText
          .split(/[,、，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        traits: traitsText
          .split(/[,、，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }
      await upsertStaff(selectedFacilityId!, isNew ? null : (staffId ?? null), data)
      navigate('/staff')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const workPatterns = shiftPatterns.filter((p) => p.isWork)

  return (
    <section className="card">
      <h2>{isNew ? '職員を追加' : '職員を編集'}</h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="form-stack wide">
        <label>
          氏名
          <input
            value={form.name}
            onChange={(e) => updateForm({ name: e.target.value })}
            required
          />
        </label>
        <label>
          フリガナ
          <input
            value={form.nameKana ?? ''}
            onChange={(e) => updateForm({ nameKana: e.target.value })}
          />
        </label>
        <label>
          役職
          <input
            value={form.position ?? ''}
            placeholder="管理者・統括・リーダーなど"
            onChange={(e) => updateForm({ position: e.target.value })}
          />
        </label>
        <fieldset>
          <legend>職種（兼務は複数選択）</legend>
          <div className="check-grid">
            {jobTypes.map((j) => (
              <label key={j.id} className="row">
                <input
                  type="checkbox"
                  checked={selectedJobTypeIds.includes(j.id)}
                  onChange={(e) => toggleJobType(j.id, e.target.checked)}
                />
                {j.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          雇用区分
          <select
            value={form.employmentTypeId ?? ''}
            onChange={(e) => updateForm({ employmentTypeId: e.target.value })}
          >
            <option value="">（未設定）</option>
            {employmentTypes.map((et) => (
              <option key={et.id} value={et.id}>
                {et.label}
              </option>
            ))}
          </select>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => updateForm({ active: e.target.checked })}
          />
          有効（在籍中）
        </label>
        <label>
          資格（カンマ区切り）
          <input
            value={qualificationsText}
            onChange={(e) => setQualificationsText(e.target.value)}
            placeholder="介護福祉士, 実務者研修"
          />
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={traitsList.includes('生活相談員')}
            onChange={(e) => toggleTrait('生活相談員', e.target.checked)}
          />
          生活相談員を兼務（シフト表に兼務行が追加されます）
        </label>
        <label>
          特性タグ（その他・カンマ区切り）
          <input value={otherTraitsText} onChange={(e) => setOtherTraitsText(e.target.value)} />
        </label>
        <p className="muted" style={{ marginTop: -8 }}>
          条件（ルール）の対象として使うタグです。
        </p>

        <h3>勤務条件（任意・空欄可）</h3>

        <fieldset>
          <legend>可能な勤務パターン</legend>
          {workPatterns.length === 0 && (
            <p className="muted">先に「勤務パターン」で登録してください。</p>
          )}
          <div className="checkbox-grid">
            {workPatterns.map((p) => (
              <label key={p.id} className="row">
                <input
                  type="checkbox"
                  checked={(wc.workablePatternIds ?? []).includes(p.id)}
                  onChange={(e) => toggleWorkablePattern(p.id, e.target.checked)}
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>固定休み曜日</legend>
          <div className="checkbox-grid">
            {WEEKDAYS.map((w, dow) => (
              <label key={dow} className="row">
                <input
                  type="checkbox"
                  checked={(wc.fixedOffWeekdays ?? []).includes(dow)}
                  onChange={(e) => toggleFixedOffWeekday(dow, e.target.checked)}
                />
                {w}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field-grid">
          <label>
            必要勤務日数（下限・月）
            <input
              type="number"
              value={wc.targetWorkdaysPerMonth ?? ''}
              onChange={(e) =>
                updateWorkConditions({ targetWorkdaysPerMonth: toNumberOrNull(e.target.value) })
              }
            />
            {targetWorkdaysIgnored && (
              <span className="warn" style={{ fontSize: '0.78rem' }}>
                雇用区分「{selectedEmploymentType?.label ?? '未設定'}」は「必要勤務日数あり」がOFFのため、
                この下限は自動生成・違反チェックで使われません。「雇用区分」画面で有効にしてください。
              </span>
            )}
          </label>
          <label>
            最大勤務日数（上限・月）
            <input
              type="number"
              value={wc.maxWorkdaysPerMonth ?? ''}
              onChange={(e) =>
                updateWorkConditions({ maxWorkdaysPerMonth: toNumberOrNull(e.target.value) })
              }
            />
          </label>
          <label>
            連続勤務上限（日）
            <input
              type="number"
              value={wc.maxConsecutiveWorkdays ?? ''}
              onChange={(e) =>
                updateWorkConditions({ maxConsecutiveWorkdays: toNumberOrNull(e.target.value) })
              }
            />
          </label>
          <label>
            夜勤回数の目標（月）
            <input
              type="number"
              value={wc.nightShiftTarget ?? ''}
              onChange={(e) =>
                updateWorkConditions({ nightShiftTarget: toNumberOrNull(e.target.value) })
              }
            />
          </label>
          <label>
            夜勤回数の上限（月）
            <input
              type="number"
              value={wc.maxNightShiftsPerMonth ?? ''}
              onChange={(e) =>
                updateWorkConditions({ maxNightShiftsPerMonth: toNumberOrNull(e.target.value) })
              }
            />
          </label>
        </div>

        {error && <p className="warn">{error}</p>}

        <div className="row" style={{ gap: 10 }}>
          <button type="submit" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="ghost" onClick={() => navigate('/staff')}>
            キャンセル
          </button>
        </div>
      </form>
    </section>
  )
}
