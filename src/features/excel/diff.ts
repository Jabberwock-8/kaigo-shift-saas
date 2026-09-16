/**
 * 取込みんだExcelの draft と、現在のFirestoreデータを突き合わせて
 * 新規/変更/削除/据え置き に分類する（P7b 手順2）。書き込みはしない。
 */
import type {
  EmploymentType,
  Rule,
  RuleCond,
  RuleTarget,
  ShiftCategory,
  ShiftPattern,
  ShiftRulesSettings,
  Staff,
} from '../../types/models'
import type { ParsedRule, ParsedStaff, TemplateDraft } from './parseTemplate'

type PatternWithId = ShiftPattern & { id: string }
type StaffWithId = Staff & { id: string }
type EmploymentTypeWithId = EmploymentType & { id: string }
type RuleWithId = Rule & { id: string }

export type DiffStatus = 'new' | 'changed' | 'unchanged'

export interface PatternDiff {
  code: string
  status: DiffStatus
  existing?: PatternWithId
  next: Omit<ShiftPattern, 'isSystem' | 'order' | 'color' | 'textColor'>
}

export interface StaffDiff {
  name: string
  status: DiffStatus
  existing?: StaffWithId
  employmentLabel: string
  next: Pick<Staff, 'qualifications' | 'traits'> & {
    workablePatternCodes: string[]
    targetWorkdaysPerMonth: number | null
    maxWorkdaysPerMonth: number | null
    nightShiftTarget: number | null
    fixedOffWeekdays: number[]
  }
}

export interface DiffResult {
  facilityName: string
  patterns: PatternDiff[]
  removablePatterns: { pattern: PatternWithId; usedElsewhere: boolean }[]
  staff: StaffDiff[]
  removableStaff: StaffWithId[]
  newEmploymentLabels: string[]
  newRuleCount: number
  skippedRuleCount: number
  /** 施設情報シートで値が入っていた項目だけの上書き分（空欄の項目は既存設定を変更しない） */
  settingsPatch: Partial<ShiftRulesSettings> | null
}

function guessCategory(isWork: boolean): ShiftCategory | undefined {
  return isWork ? 'day' : undefined
}

function patternsEqual(a: PatternWithId, b: PatternDiff['next']): boolean {
  return (
    a.label === b.label &&
    (a.startTime ?? '') === (b.startTime ?? '') &&
    (a.endTime ?? '') === (b.endTime ?? '') &&
    (a.breakHours ?? 0) === (b.breakHours ?? 0) &&
    a.isWork === b.isWork &&
    a.isNight === b.isNight
  )
}

export interface ExistingData {
  facilityName: string
  patterns: PatternWithId[]
  staff: StaffWithId[]
  employmentTypes: EmploymentTypeWithId[]
  rules: RuleWithId[]
}

function ruleSignature(r: { enabled: boolean; kind: string; days: unknown; target: unknown; cond: unknown }): string {
  return JSON.stringify({ enabled: r.enabled, kind: r.kind, days: r.days, target: r.target, cond: r.cond })
}

/** 条件ルールの target/cond に含まれる「記号」「氏名」を、現在のIDへ解決する。解決できなければnull */
function resolveRuleIds(
  r: ParsedRule,
  codeToId: Map<string, string>,
  nameToId: Map<string, string>,
): { target: RuleTarget; cond: RuleCond } | null {
  let target: RuleTarget
  if (r.target.type === 'shift' || r.target.type === 'secondaryShift') {
    const id = codeToId.get(r.target.value as string)
    if (!id) return null
    target = { type: r.target.type, value: id }
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

export function buildDiff(draft: TemplateDraft, existing: ExistingData): DiffResult {
  // 勤務記号
  const existingByCode = new Map(existing.patterns.map((p) => [p.code, p]))
  const patterns: PatternDiff[] = draft.shiftPatterns.map((p) => {
    const next: PatternDiff['next'] = {
      code: p.code,
      label: p.label,
      startTime: p.startTime,
      endTime: p.endTime,
      breakHours: p.breakHours,
      isWork: p.isWork,
      isNight: p.isNight,
      category: guessCategory(p.isWork),
    }
    const ex = existingByCode.get(p.code)
    return { code: p.code, existing: ex, next, status: !ex ? 'new' : patternsEqual(ex, next) ? 'unchanged' : 'changed' }
  })
  const draftCodes = new Set(draft.shiftPatterns.map((p) => p.code))
  const usedPatternIds = new Set<string>()
  for (const s of existing.staff) for (const id of s.workConditions?.workablePatternIds ?? []) usedPatternIds.add(id)
  for (const r of existing.rules) {
    if (r.target.type === 'shift' && typeof r.target.value === 'string') usedPatternIds.add(r.target.value)
    if (r.target.type === 'shiftGroup') (r.target.value as string[] | undefined)?.forEach((id) => usedPatternIds.add(id))
    if (r.cond.type === 'preferShift' && r.cond.value) usedPatternIds.add(r.cond.value)
  }
  const removablePatterns = existing.patterns
    .filter((p) => !p.isSystem && !draftCodes.has(p.code))
    .map((pattern) => ({ pattern, usedElsewhere: usedPatternIds.has(pattern.id) }))

  // 新規作成予定のパターンもルール参照先として解決できるよう、プレースホルダIDを割り当てる
  // （実IDはapplyDiff実行時に確定するが、プレビューでは「参照できるかどうか」だけ分かればよい）
  const codeToId = new Map(existing.patterns.map((p) => [p.code, p.id]))
  for (const p of patterns) if (!codeToId.has(p.code)) codeToId.set(p.code, p.existing?.id ?? `__new__:${p.code}`)

  // 雇用区分
  const employmentLabels = new Set(existing.employmentTypes.map((e) => e.label))
  const newEmploymentLabels = [...new Set(draft.staff.map((s) => s.employment))].filter((l) => !employmentLabels.has(l))

  // 職員
  const existingByName = new Map(existing.staff.map((s) => [s.name, s]))
  // パターンと同様、新規作成予定の職員もルール参照先として解決できるようにする
  const nameToId = new Map(existing.staff.map((s) => [s.name, s.id]))
  for (const s of draft.staff) if (!nameToId.has(s.name)) nameToId.set(s.name, `__new__:${s.name}`)
  const staffDiffs: StaffDiff[] = draft.staff.map((s: ParsedStaff) => {
    const next: StaffDiff['next'] = {
      qualifications: s.qualifications,
      traits: s.traits,
      workablePatternCodes: s.workablePatternCodes,
      targetWorkdaysPerMonth: s.targetWorkdaysPerMonth,
      maxWorkdaysPerMonth: s.maxWorkdaysPerMonth,
      nightShiftTarget: s.nightShiftTarget,
      fixedOffWeekdays: s.fixedOffWeekdays,
    }
    const ex = existingByName.get(s.name)
    let status: DiffStatus = 'new'
    if (ex) {
      const wc = ex.workConditions ?? {}
      const sameArr = (x: string[] | undefined, y: string[]) =>
        JSON.stringify([...(x ?? [])].sort()) === JSON.stringify([...y].sort())
      const existingCodes = (wc.workablePatternIds ?? []).map((id) => existing.patterns.find((p) => p.id === id)?.code ?? id)
      const unchanged =
        sameArr(ex.qualifications, next.qualifications ?? []) &&
        sameArr(ex.traits, next.traits ?? []) &&
        sameArr(existingCodes, next.workablePatternCodes) &&
        (wc.targetWorkdaysPerMonth ?? null) === next.targetWorkdaysPerMonth &&
        (wc.maxWorkdaysPerMonth ?? null) === next.maxWorkdaysPerMonth &&
        (wc.nightShiftTarget ?? null) === next.nightShiftTarget &&
        sameArr((wc.fixedOffWeekdays ?? []).map(String), next.fixedOffWeekdays.map(String))
      status = unchanged ? 'unchanged' : 'changed'
    }
    return { name: s.name, status, existing: ex, employmentLabel: s.employment, next }
  })
  const draftNames = new Set(draft.staff.map((s) => s.name))
  const removableStaff = existing.staff.filter((s) => !draftNames.has(s.name))

  // 条件ルール（内容が完全一致するものは据え置き扱いとしてカウントのみ。新規のみ追加対象にする）
  const existingSignatures = new Set(existing.rules.map((r) => ruleSignature(r)))
  let newRuleCount = 0
  let skippedRuleCount = 0
  for (const r of draft.rules) {
    const resolved = resolveRuleIds(r, codeToId, nameToId)
    if (!resolved) {
      skippedRuleCount++
      continue
    }
    const sig = ruleSignature({ enabled: r.enabled, kind: r.kind, days: r.days, ...resolved })
    if (!existingSignatures.has(sig)) newRuleCount++
  }

  // 施設情報（空欄の項目は既存設定を変更しない）
  const settingsPatchObj: Partial<ShiftRulesSettings> = {}
  if (draft.facility.nightMode != null) settingsPatchObj.nightMode = draft.facility.nightMode
  if (draft.facility.minRestHours != null) settingsPatchObj.minRestHours = draft.facility.minRestHours
  if (draft.facility.nightAvoidPatternCodes.length > 0) {
    // codeToIdには新規パターン用のプレースホルダも入っているため、実IDだけに絞る
    // （新規パターンは反映後の実IDが確定してから、あらためて設定してもらう）
    const ids = draft.facility.nightAvoidPatternCodes
      .map((c) => codeToId.get(c))
      .filter((v): v is string => !!v && !v.startsWith('__new__:'))
    if (ids.length > 0) settingsPatchObj.nightAvoidPatternIdsAfter2 = ids
  }
  const settingsPatch = Object.keys(settingsPatchObj).length > 0 ? settingsPatchObj : null

  return {
    facilityName: draft.facility.facilityName,
    patterns,
    removablePatterns,
    staff: staffDiffs,
    removableStaff,
    newEmploymentLabels,
    newRuleCount,
    skippedRuleCount,
    settingsPatch,
  }
}
