/**
 * 差分プレビューで確認した内容をFirestoreへ反映する（P7b 手順6）。
 * 500件を超える書き込みは想定していないため単純な逐次書き込みでよい
 * （旧HTML版と違い「丸ごと差し替え」ではなく、変更があったものだけ書き込む）。
 */
import {
  deleteShiftPattern,
  deleteStaff,
  saveShiftRulesSettings,
  upsertEmploymentType,
  upsertRule,
  upsertShiftPattern,
  upsertStaff,
} from '../../lib/firestore'
import type { ExistingData, DiffResult } from './diff'
import type { TemplateDraft } from './parseTemplate'
import type { RuleCond, RuleTarget } from '../../types/models'

export interface ApplyOptions {
  /** 削除してよい勤務パターンの記号 */
  deletePatternCodes: Set<string>
  /** 削除してよい職員の氏名 */
  deleteStaffNames: Set<string>
}

function resolveRuleIds(
  r: TemplateDraft['rules'][number],
  codeToId: Map<string, string>,
  nameToId: Map<string, string>,
): { target: RuleTarget; cond: RuleCond } | null {
  let target: RuleTarget
  if (r.target.type === 'shift') {
    const id = codeToId.get(r.target.value as string)
    if (!id) return null
    target = { type: 'shift', value: id }
  } else if (r.target.type === 'staff') {
    const id = nameToId.get(r.target.value as string)
    if (!id) return null
    target = { type: 'staff', value: id }
  } else if (r.target.type === 'shiftGroup') {
    const ids = (r.target.value as string[]).map((c) => codeToId.get(c)).filter((v): v is string => !!v)
    if (ids.length < 2) return null
    target = { type: 'shiftGroup', value: ids }
  } else {
    target = r.target
  }

  let cond: RuleCond = r.cond
  if (r.cond.type === 'preferShift') {
    const id = codeToId.get(r.cond.value ?? '')
    if (!id) return null
    cond = { type: 'preferShift', value: id }
  }
  return { target, cond }
}

function ruleSignature(r: { enabled: boolean; kind: string; days: unknown; target: unknown; cond: unknown }): string {
  return JSON.stringify({ enabled: r.enabled, kind: r.kind, days: r.days, target: r.target, cond: r.cond })
}

export async function applyDiff(
  facilityId: string,
  draft: TemplateDraft,
  diff: DiffResult,
  existing: ExistingData,
  options: ApplyOptions,
): Promise<string[]> {
  const log: string[] = []

  // 1. 雇用区分（新規のみ）
  const employmentIdByLabel = new Map(existing.employmentTypes.map((e) => [e.label, e.id]))
  let etOrder = existing.employmentTypes.reduce((m, e) => Math.max(m, e.order ?? 0), 0)
  for (const label of diff.newEmploymentLabels) {
    etOrder += 1
    const id = await upsertEmploymentType(facilityId, null, { label, order: etOrder, hasTargetWorkdays: label === '常勤' })
    employmentIdByLabel.set(label, id)
  }
  if (diff.newEmploymentLabels.length) log.push(`雇用区分: 新規 ${diff.newEmploymentLabels.length}件`)

  // 2. 勤務パターン（新規・変更のみ）
  const codeToId = new Map(existing.patterns.map((p) => [p.code, p.id]))
  let patOrder = existing.patterns.reduce((m, p) => Math.max(m, p.order ?? 0), 0)
  let createdPatterns = 0
  let updatedPatterns = 0
  for (const p of diff.patterns) {
    if (p.status === 'unchanged') continue
    if (p.status === 'new') patOrder += 1
    const id = await upsertShiftPattern(facilityId, p.existing?.id ?? null, {
      code: p.next.code,
      label: p.next.label,
      startTime: p.next.startTime,
      endTime: p.next.endTime,
      category: p.next.category,
      isWork: p.next.isWork,
      isNight: p.next.isNight,
      isSystem: false,
      order: p.existing?.order ?? patOrder,
      color: p.existing?.color,
      textColor: p.existing?.textColor,
    })
    codeToId.set(p.code, id)
    if (p.status === 'new') createdPatterns++
    else updatedPatterns++
  }
  log.push(`勤務パターン: 新規 ${createdPatterns}件 / 更新 ${updatedPatterns}件`)

  // 3. 勤務パターンの削除（チェックされたものだけ）
  let deletedPatterns = 0
  for (const { pattern, usedElsewhere } of diff.removablePatterns) {
    if (!options.deletePatternCodes.has(pattern.code) || usedElsewhere) continue
    await deleteShiftPattern(facilityId, pattern.id)
    deletedPatterns++
  }
  if (deletedPatterns) log.push(`勤務パターン: 削除 ${deletedPatterns}件`)

  // 4. 職員（新規・変更のみ）
  const nameToId = new Map(existing.staff.map((s) => [s.name, s.id]))
  let staffOrder = existing.staff.reduce((m, s) => Math.max(m, s.order ?? 0), 0)
  let createdStaff = 0
  let updatedStaff = 0
  for (const s of diff.staff) {
    if (s.status === 'unchanged') continue
    const workablePatternIds = s.next.workablePatternCodes.map((c) => codeToId.get(c)).filter((v): v is string => !!v)
    const employmentTypeId = employmentIdByLabel.get(s.employmentLabel) ?? ''
    if (s.status === 'new') {
      staffOrder += 1
      const id = await upsertStaff(facilityId, null, {
        name: s.name,
        employmentTypeId,
        active: true,
        order: staffOrder,
        qualifications: s.next.qualifications,
        traits: s.next.traits,
        workConditions: {
          workablePatternIds,
          targetWorkdaysPerMonth: s.next.targetWorkdaysPerMonth,
          maxWorkdaysPerMonth: s.next.maxWorkdaysPerMonth,
          nightShiftTarget: s.next.nightShiftTarget,
          fixedOffWeekdays: s.next.fixedOffWeekdays,
        },
      })
      nameToId.set(s.name, id)
      createdStaff++
    } else if (s.existing) {
      await upsertStaff(facilityId, s.existing.id, {
        ...s.existing,
        employmentTypeId,
        qualifications: s.next.qualifications,
        traits: s.next.traits,
        workConditions: {
          ...(s.existing.workConditions ?? {}),
          workablePatternIds,
          targetWorkdaysPerMonth: s.next.targetWorkdaysPerMonth,
          maxWorkdaysPerMonth: s.next.maxWorkdaysPerMonth,
          nightShiftTarget: s.next.nightShiftTarget,
          fixedOffWeekdays: s.next.fixedOffWeekdays,
        },
      })
      updatedStaff++
    }
  }
  log.push(`職員: 新規 ${createdStaff}名 / 更新 ${updatedStaff}名`)

  // 5. 職員の削除（チェックされたものだけ）
  let deletedStaff = 0
  for (const s of diff.removableStaff) {
    if (!options.deleteStaffNames.has(s.name)) continue
    await deleteStaff(facilityId, s.id)
    deletedStaff++
  }
  if (deletedStaff) log.push(`職員: 削除 ${deletedStaff}件`)

  // 6. 条件ルール（新規のみ追加。同一内容の既存ルールと重複させない）
  const existingSignatures = new Set(existing.rules.map((r) => ruleSignature(r)))
  let ruleOrder = existing.rules.reduce((m, r) => Math.max(m, r.order ?? 0), 0)
  let createdRules = 0
  for (const r of draft.rules) {
    const resolved = resolveRuleIds(r, codeToId, nameToId)
    if (!resolved) continue
    const sig = ruleSignature({ enabled: r.enabled, kind: r.kind, days: r.days, ...resolved })
    if (existingSignatures.has(sig)) continue
    ruleOrder += 1
    await upsertRule(facilityId, null, { enabled: r.enabled, kind: r.kind, days: r.days, ...resolved, order: ruleOrder })
    existingSignatures.add(sig)
    createdRules++
  }
  log.push(`条件ルール: 新規 ${createdRules}件`)

  // 7. 施設情報（施設情報シートに値が入っていた項目だけ）
  if (diff.settingsPatch) {
    await saveShiftRulesSettings(facilityId, diff.settingsPatch as Parameters<typeof saveShiftRulesSettings>[1])
    log.push('設定（夜勤運用・休息時間など）を更新しました')
  }

  return log
}
