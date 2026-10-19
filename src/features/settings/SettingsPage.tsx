import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import {
  DEFAULT_SHIFT_RULES_SETTINGS,
  fetchShiftRulesSettings,
  saveShiftRulesSettings,
} from '../../lib/firestore'
import type { NightMode, ShiftRulesSettings } from '../../types/models'

function toNumberOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export default function SettingsPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns } = useMasters()
  const isAdmin = appUser?.role === 'admin'

  const [settings, setSettings] = useState<ShiftRulesSettings>(DEFAULT_SHIFT_RULES_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [capPatternId, setCapPatternId] = useState('')
  const [capDays, setCapDays] = useState(2)

  useEffect(() => {
    if (!selectedFacilityId) return
    setLoading(true)
    fetchShiftRulesSettings(selectedFacilityId)
      .then(setSettings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [selectedFacilityId])

  if (!selectedFacilityId) return null

  const workPatterns = shiftPatterns.filter((p) => p.isWork)

  function update(patch: Partial<ShiftRulesSettings>) {
    setSettings((s) => ({ ...s, ...patch }))
    setSaved(false)
  }

  function toggleAvoidPattern(id: string, checked: boolean) {
    const cur = new Set(settings.nightAvoidPatternIdsAfter2)
    if (checked) cur.add(id)
    else cur.delete(id)
    update({ nightAvoidPatternIdsAfter2: [...cur] })
  }

  function addCap() {
    if (!capPatternId) return
    update({
      shiftConsecutiveCaps: { ...settings.shiftConsecutiveCaps, [capPatternId]: capDays },
    })
    setCapPatternId('')
    setCapDays(2)
  }

  function removeCap(patternId: string) {
    const next = { ...settings.shiftConsecutiveCaps }
    delete next[patternId]
    update({ shiftConsecutiveCaps: next })
  }

  async function handleSave() {
    if (!isAdmin) return
    setSaving(true)
    setError(null)
    try {
      await saveShiftRulesSettings(selectedFacilityId!, settings)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="muted">読み込み中…</p>

  return (
    <section className="card">
      <h2>設定</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        ここで決めた内容は、シフト表の違反チェックと今後の自動生成に使われます。未設定の項目は
        「制約なし」として扱われます。
      </p>

      <fieldset className="settings-fieldset">
        <legend>夜勤の運用</legend>
        <label className="field-row">
          夜勤明けの扱い
          <select
            value={settings.nightMode ?? ''}
            disabled={!isAdmin}
            onChange={(e) => update({ nightMode: (e.target.value || null) as NightMode | null })}
          >
            <option value="">未設定（制約なし）</option>
            <option value="ake">「明休」「明出」を使う（夜→明休）</option>
            <option value="direct">「明」を使わず公休に直行（夜→休）</option>
          </select>
        </label>

        {settings.nightMode === 'direct' && (
          <div className="field-row">
            夜勤の2日後に避ける勤務
            <div className="checkbox-inline">
              {workPatterns.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={settings.nightAvoidPatternIdsAfter2.includes(p.id)}
                    disabled={!isAdmin}
                    onChange={(e) => toggleAvoidPattern(p.id, e.target.checked)}
                  />
                  {p.code}
                </label>
              ))}
            </div>
          </div>
        )}
        {settings.nightMode === 'ake' && (
          <>
            <label className="field-row">
              <input
                type="checkbox"
                checked={settings.akeRequiresOffNextDay !== false}
                disabled={!isAdmin}
                onChange={(e) => update({ akeRequiresOffNextDay: e.target.checked })}
              />
              明休・明出の翌日を必ず公休にする（夜→明出→休）
            </label>
            <label className="field-row">
              <input
                type="checkbox"
                checked={settings.akeAllowConsecutiveNights === true}
                disabled={!isAdmin}
                onChange={(e) => update({ akeAllowConsecutiveNights: e.target.checked })}
              />
              夜勤の連続を認める（夜→夜→明休。明休は連続の最後の翌日）
            </label>
            <p className="muted">
              夜勤の翌日に、種別「夜勤明け」の勤務パターンが必要です（勤務パターン画面で種別を設定してください）。
              準夜勤（21:00〜翌7:00 など）で翌日を「明休」として休みに数える場合は、チェックを外すと明休の翌日に自由に勤務を入れられます
              （明休の勤務パターンは「勤務」のチェックを外してください）。
              ロング夜勤（16:00〜翌9:00 など）で翌日が「明出」の勤務になり、その翌日を必ず休みにする場合は、チェックを入れます。
              夜勤の連続を認める場合、何日まで続けてよいかは下の「勤務パターン別の連続日数上限」で夜勤を選んで決めます。
              自動生成は連続夜勤を自分では作りません。続けたい夜勤はシフト表で入力してロックしてから生成してください（連続の最後の翌日に明休が自動で入ります）。
            </p>
          </>
        )}
      </fieldset>

      <fieldset className="settings-fieldset">
        <legend>勤務パターン別の連続日数上限</legend>
        {Object.keys(settings.shiftConsecutiveCaps).length === 0 && (
          <p className="muted">設定なし。</p>
        )}
        <ul className="cap-list">
          {Object.entries(settings.shiftConsecutiveCaps).map(([patternId, days]) => {
            const label = shiftPatterns.find((p) => p.id === patternId)?.label ?? patternId
            return (
              <li key={patternId}>
                <span>
                  {label}: 連続{days}日まで
                </span>
                {isAdmin && (
                  <button type="button" className="ghost" onClick={() => removeCap(patternId)}>
                    削除
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {isAdmin && (
          <div className="field-row">
            <select value={capPatternId} onChange={(e) => setCapPatternId(e.target.value)}>
              <option value="">（勤務パターンを選択）</option>
              {workPatterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={15}
              value={capDays}
              onChange={(e) => setCapDays(Number(e.target.value))}
              style={{ width: 60 }}
            />
            日まで
            <button type="button" onClick={addCap}>
              追加
            </button>
          </div>
        )}
      </fieldset>

      <fieldset className="settings-fieldset">
        <legend>働きやすさへの配慮</legend>
        <label className="field-row">
          最低休息時間（時間）
          <input
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={settings.minRestHours ?? ''}
            disabled={!isAdmin}
            placeholder="未設定"
            onChange={(e) => update({ minRestHours: toNumberOrNull(e.target.value) })}
            style={{ width: 80 }}
          />
        </label>
        <p className="muted">
          前日の勤務終了から翌日の勤務開始までの間隔がこれより短い並びを、違反として表示します。
        </p>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.treatRestHoursAsHard !== false}
            disabled={!isAdmin}
            onChange={(e) => update({ treatRestHoursAsHard: e.target.checked })}
          />
          休息時間不足を必須条件として扱う（自動生成でも配置しない。既定でオン。外すと推奨のみに戻ります）
        </label>

        <label className="field-row">
          不足分を埋める時間帯
          <input
            type="time"
            value={settings.preferredFillTimeRange.start ?? ''}
            disabled={!isAdmin}
            onChange={(e) =>
              update({
                preferredFillTimeRange: { ...settings.preferredFillTimeRange, start: e.target.value || null },
              })
            }
          />
          〜
          <input
            type="time"
            value={settings.preferredFillTimeRange.end ?? ''}
            disabled={!isAdmin}
            onChange={(e) =>
              update({
                preferredFillTimeRange: { ...settings.preferredFillTimeRange, end: e.target.value || null },
              })
            }
          />
        </label>
      </fieldset>

      <fieldset className="settings-fieldset">
        <legend>希望休</legend>
        <label className="field-row">
          月の上限（日数）
          <input
            type="number"
            min={0}
            max={31}
            value={settings.maxWishesPerMonth ?? ''}
            disabled={!isAdmin}
            placeholder="未設定（上限なし）"
            onChange={(e) => update({ maxWishesPerMonth: toNumberOrNull(e.target.value) })}
            style={{ width: 80 }}
          />
        </label>
        <p className="muted">
          職員1人あたり、1ヶ月に入力できる希望休の日数の上限です（有給希望も同じ枠でカウントします）。超えて選ぼうとすると入力できません。
        </p>
      </fieldset>

      <fieldset className="settings-fieldset">
        <legend>相性</legend>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.treatCompatibilityXAsHard !== false}
            disabled={!isAdmin}
            onChange={(e) => update({ treatCompatibilityXAsHard: e.target.checked })}
          />
          相性×のペアを同一シフトに配置しないことを必須条件として扱う
        </label>
      </fieldset>

      <fieldset className="settings-fieldset">
        <legend>施設の既定値（職員ごとの個別設定が優先されます）</legend>
        <div className="field-grid">
          <label>
            連続勤務上限（日）
            <input
              type="number"
              value={settings.maxConsecutiveWorkdaysDefault ?? ''}
              disabled={!isAdmin}
              placeholder="未設定"
              onChange={(e) =>
                update({ maxConsecutiveWorkdaysDefault: toNumberOrNull(e.target.value) })
              }
            />
          </label>
          <label>
            月の公休日数
            <input
              type="number"
              value={settings.monthlyLimitsDefault.offDaysPerMonth ?? ''}
              disabled={!isAdmin}
              placeholder="未設定"
              onChange={(e) =>
                update({
                  monthlyLimitsDefault: {
                    ...settings.monthlyLimitsDefault,
                    offDaysPerMonth: toNumberOrNull(e.target.value),
                  },
                })
              }
            />
          </label>
          <p className="muted" style={{ gridColumn: '1 / -1', margin: 0 }}>
            月の公休日数を入れると、勤務日数（下限・上限）が「その月の日数 − 公休日数」になり、下の2つより優先されます
            （公休10日なら、30日の月は20日・31日の月は21日）。職員ごとの設定や「月の上限を調整」はこれより優先されます。
          </p>
          <label>
            必要勤務日数（下限・月）
            <input
              type="number"
              value={settings.monthlyLimitsDefault.targetWorkdays ?? ''}
              disabled={!isAdmin || settings.monthlyLimitsDefault.offDaysPerMonth != null}
              placeholder="未設定"
              onChange={(e) =>
                update({
                  monthlyLimitsDefault: {
                    ...settings.monthlyLimitsDefault,
                    targetWorkdays: toNumberOrNull(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            最大勤務日数（上限・月）
            <input
              type="number"
              value={settings.monthlyLimitsDefault.maxWorkdays ?? ''}
              disabled={!isAdmin || settings.monthlyLimitsDefault.offDaysPerMonth != null}
              placeholder="未設定"
              onChange={(e) =>
                update({
                  monthlyLimitsDefault: {
                    ...settings.monthlyLimitsDefault,
                    maxWorkdays: toNumberOrNull(e.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            夜勤回数の上限（月）
            <input
              type="number"
              value={settings.monthlyLimitsDefault.maxNightShifts ?? ''}
              disabled={!isAdmin}
              placeholder="未設定"
              onChange={(e) =>
                update({
                  monthlyLimitsDefault: {
                    ...settings.monthlyLimitsDefault,
                    maxNightShifts: toNumberOrNull(e.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      </fieldset>

      {error && <p className="warn">{error}</p>}
      {isAdmin && (
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          {saved && <span className="ok">保存しました</span>}
        </div>
      )}
    </section>
  )
}
