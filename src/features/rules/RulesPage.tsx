import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { deleteRule, fetchStaffList, listRules, setRuleEnabled, upsertRule } from '../../lib/firestore'
import type { Rule, Staff } from '../../types/models'
import { ruleText } from '../../domain/scheduler/ruleText'
import RuleForm from './RuleForm'

type StaffWithId = Staff & { id: string }

export default function RulesPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns } = useMasters()
  const isAdmin = appUser?.role === 'admin'

  const [rules, setRules] = useState<(Rule & { id: string })[]>([])
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [rl, sl] = await Promise.all([
        listRules(selectedFacilityId),
        fetchStaffList(selectedFacilityId),
      ])
      setRules(rl)
      setStaffList(sl)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId])

  if (!selectedFacilityId) return null

  const shiftLabel = (id: string) => shiftPatterns.find((p) => p.id === id)?.label ?? '?'
  const staffName = (id: string) => staffList.find((s) => s.id === id)?.name ?? '?'
  const ctx = { shiftLabel, staffName }

  async function handleToggle(rule: Rule & { id: string }) {
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))
    try {
      await setRuleEnabled(selectedFacilityId!, rule.id, !rule.enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
    }
  }

  async function handleDelete(rule: Rule & { id: string }) {
    if (!confirm(`このルールを削除しますか？\n「${ruleText(rule, ctx)}」`)) return
    await deleteRule(selectedFacilityId!, rule.id)
    await load()
  }

  async function handleCreate(rule: Rule) {
    await upsertRule(selectedFacilityId!, null, rule)
    await load()
  }

  const nextOrder = rules.reduce((max, r) => Math.max(max, r.order ?? 0), 0) + 1

  return (
    <section className="card">
      <h2>条件</h2>

      {isAdmin && (
        <div className="card inner">
          <h3>新しいルールを追加</h3>
          <RuleForm
            shiftPatterns={shiftPatterns}
            staffList={staffList}
            nextOrder={nextOrder}
            onSubmit={handleCreate}
          />
        </div>
      )}

      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      {!loading && rules.length === 0 && <p className="muted">ルールがありません。</p>}

      {rules.length > 0 && (
        <ul className="rule-list">
          {rules.map((r) => (
            <li key={r.id} className={`rule-row ${r.enabled ? '' : 'disabled'}`}>
              <input
                type="checkbox"
                checked={r.enabled}
                disabled={!isAdmin}
                onChange={() => void handleToggle(r)}
              />
              <span className="rule-text">{ruleText(r, ctx)}</span>
              <span className={`badge ${r.kind}`}>{r.kind === 'hard' ? '必須' : '推奨'}</span>
              {isAdmin && (
                <button type="button" className="ghost" onClick={() => void handleDelete(r)}>
                  削除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
