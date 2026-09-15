/**
 * 取り込みが途中で失敗し再実行した場合などに生じる、同じ記号(code)の勤務パターンの
 * 重複を検出・整理するための一時的なユーティリティ。
 * 職員の勤務可能パターン・条件ルール・設定のいずれからも参照されていない方を「未使用」として削除する。
 */
import type { Rule, ShiftPattern, ShiftRulesSettings, Staff } from '../../types/models'

type PatternWithId = ShiftPattern & { id: string }
type StaffWithId = Staff & { id: string }
type RuleWithId = Rule & { id: string }

export interface DuplicateGroup {
  code: string
  label: string
  /** 残す（いずれかから参照されている、または最も古い）パターンID */
  keepId: string
  /** 削除してよいパターンID */
  removeIds: string[]
}

function collectUsedPatternIds(
  staff: StaffWithId[],
  rules: RuleWithId[],
  settings: ShiftRulesSettings,
): Set<string> {
  const used = new Set<string>()
  for (const s of staff) {
    for (const id of s.workConditions?.workablePatternIds ?? []) used.add(id)
  }
  for (const r of rules) {
    if (r.target.type === 'shift' && typeof r.target.value === 'string') used.add(r.target.value)
    if (r.target.type === 'shiftGroup' && Array.isArray(r.target.value)) {
      r.target.value.forEach((id) => used.add(id))
    }
    if (r.cond.type === 'preferShift' && r.cond.value) used.add(r.cond.value)
  }
  for (const id of settings.nightAvoidPatternIdsAfter2) used.add(id)
  for (const id of Object.keys(settings.shiftConsecutiveCaps)) used.add(id)
  return used
}

/** 記号(code)が同じパターンが複数あるものだけを重複グループとして返す */
export function findDuplicatePatternGroups(
  patterns: PatternWithId[],
  staff: StaffWithId[],
  rules: RuleWithId[],
  settings: ShiftRulesSettings,
): DuplicateGroup[] {
  const usedIds = collectUsedPatternIds(staff, rules, settings)

  const byCode = new Map<string, PatternWithId[]>()
  for (const p of patterns) {
    const list = byCode.get(p.code) ?? []
    list.push(p)
    byCode.set(p.code, list)
  }

  const groups: DuplicateGroup[] = []
  for (const [code, list] of byCode) {
    if (list.length < 2) continue
    const used = list.filter((p) => usedIds.has(p.id))
    const sorted = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const keep = used[0] ?? sorted[0]
    const removeIds = list.filter((p) => p.id !== keep.id).map((p) => p.id)
    groups.push({ code, label: keep.label, keepId: keep.id, removeIds })
  }
  return groups
}

export interface DuplicateRuleGroup {
  /** 表示用（対象・条件のJSON。人間可読なラベルはUI側で作る） */
  signature: string
  keepId: string
  removeIds: string[]
}

/** enabled/kind/days/target/cond の内容が完全一致するルールが複数あるものだけを重複グループとして返す */
export function findDuplicateRuleGroups(rules: RuleWithId[]): DuplicateRuleGroup[] {
  const bySignature = new Map<string, RuleWithId[]>()
  for (const r of rules) {
    const signature = JSON.stringify({ enabled: r.enabled, kind: r.kind, days: r.days, target: r.target, cond: r.cond })
    const list = bySignature.get(signature) ?? []
    list.push(r)
    bySignature.set(signature, list)
  }

  const groups: DuplicateRuleGroup[] = []
  for (const [signature, list] of bySignature) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const keep = sorted[0]
    const removeIds = list.filter((r) => r.id !== keep.id).map((r) => r.id)
    groups.push({ signature, keepId: keep.id, removeIds })
  }
  return groups
}
