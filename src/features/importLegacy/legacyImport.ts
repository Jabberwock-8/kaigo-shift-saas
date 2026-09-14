/**
 * 旧HTML版のJSONバックアップ（docs/legacy-html-analysis.md §2 の `S`）から、
 * 勤務パターン・職員・条件ルール・相性・希望休・設定をまとめて取り込む一時的な移行ツール。
 * P7(Excel取込)の代わりに「今すぐ手入力を減らしたい」という要望に応えるための最小実装で、
 * 差分プレビューは持たない（実行は1回だけを前提とする）。
 */
import {
  deleteShiftPattern,
  saveShiftRulesSettings,
  setCompatibility,
  setWish,
  upsertEmploymentType,
  upsertRule,
  upsertShiftPattern,
  upsertStaff,
} from '../../lib/firestore'
import type {
  CompatibilityLevel,
  EmploymentType,
  Rule,
  RuleCond,
  RuleTarget,
  ShiftCategory,
  ShiftPattern,
  Staff,
} from '../../types/models'

export interface LegacyShiftType {
  id: string
  symbol: string
  name: string
  start?: string
  end?: string
  color?: string
  text?: string
  isWork: boolean
  isNight: boolean
  fixed?: boolean
}

export interface LegacyStaff {
  id: string
  name: string
  employment: string
  maxDaysPerMonth?: number
  maxConsecutive?: number
  allowedShiftIds?: string[]
  qualifications?: string[]
  traits?: string[]
  nightShiftTarget?: number
}

export interface LegacyCompatibility {
  a: string
  b: string
  level: CompatibilityLevel | 'good'
}

export interface LegacyRule {
  id: string
  enabled: boolean
  strength: 'hard' | 'soft'
  days: Rule['days']
  target: RuleTarget
  cond: RuleCond
}

export interface LegacyBackup {
  meta: {
    facilityName?: string
    compHard?: boolean
    nightMode?: 'ake' | 'direct' | null
    nightAvoidShiftAfter2?: string[]
    shiftConsecutiveCaps?: Record<string, number>
    minRestHours?: number | null
    preferredFillShift?: { start?: string | null; end?: string | null }
  }
  shiftTypes: LegacyShiftType[]
  staff: LegacyStaff[]
  compatibility?: LegacyCompatibility[]
  rules?: LegacyRule[]
  wishes?: Record<string, string[]>
}

export interface ImportContext {
  facilityId: string
  uid: string
  existingEmploymentTypes: (EmploymentType & { id: string })[]
  existingShiftPatterns: (ShiftPattern & { id: string })[]
  existingStaff: (Staff & { id: string })[]
  /** チェックが付いていれば、取り込み後にこの勤務パターンを削除する（仮登録の置き換え用） */
  removePlaceholderPatternId: string | null
}

export interface ImportResult {
  log: string[]
}

function findExistingFixedPattern(
  existing: (ShiftPattern & { id: string })[],
  st: LegacyShiftType,
): (ShiftPattern & { id: string }) | undefined {
  if (st.id === 'off') {
    return existing.find(
      (p) => p.category === 'off' || p.label.includes('公休') || p.code === '公休' || p.code === '休',
    )
  }
  if (st.id === 'paid') {
    return existing.find(
      (p) => p.category === 'paidLeave' || p.label.includes('有給') || p.code === '有給' || p.code === '有',
    )
  }
  return undefined
}

/** Firestore は undefined を許容しないため、undefined なプロパティを取り除いて渡す */
function pruneUndefined<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

function guessCategory(st: LegacyShiftType): ShiftCategory | undefined {
  if (st.fixed) return st.id === 'off' ? 'off' : st.id === 'paid' ? 'paidLeave' : undefined
  if (st.isNight) return 'night'
  if (!st.start && !st.end) return 'individual'
  return 'day'
}

function remapRuleTarget(
  target: RuleTarget,
  staffIdMap: Map<string, string>,
  patternIdMap: Map<string, string>,
): RuleTarget | null {
  switch (target.type) {
    case 'staff': {
      const v = staffIdMap.get(target.value as string)
      return v ? { type: 'staff', value: v } : null
    }
    case 'shift': {
      const v = patternIdMap.get(target.value as string)
      return v ? { type: 'shift', value: v } : null
    }
    case 'shiftGroup': {
      const ids = (target.value as string[])
        .map((oldId) => patternIdMap.get(oldId))
        .filter((v): v is string => !!v)
      return ids.length > 0 ? { type: 'shiftGroup', value: ids } : null
    }
    default:
      return target
  }
}

function remapRuleCond(cond: RuleCond, patternIdMap: Map<string, string>): RuleCond | null {
  if (cond.type === 'preferShift') {
    const v = patternIdMap.get(cond.value as string)
    return v ? { type: 'preferShift', value: v } : null
  }
  return cond
}

export async function runLegacyImport(backup: LegacyBackup, ctx: ImportContext): Promise<ImportResult> {
  const log: string[] = []

  // 1. 雇用区分（同名があれば再利用）
  const employmentIdByLabel = new Map<string, string>()
  for (const et of ctx.existingEmploymentTypes) employmentIdByLabel.set(et.label, et.id)
  const employments = [...new Set(backup.staff.map((s) => s.employment))]
  let etOrder = ctx.existingEmploymentTypes.reduce((max, e) => Math.max(max, e.order ?? 0), 0)
  let newEmploymentTypes = 0
  for (const label of employments) {
    if (employmentIdByLabel.has(label)) continue
    etOrder += 1
    const id = await upsertEmploymentType(ctx.facilityId, null, {
      label,
      order: etOrder,
      hasTargetWorkdays: label === '常勤',
    })
    employmentIdByLabel.set(label, id)
    newEmploymentTypes++
  }
  log.push(`雇用区分: 新規 ${newEmploymentTypes}件（既存を含め計${employments.length}種類を使用）`)

  // 2. 勤務パターン（公休・有給は既存のシステム固定パターンに紐付け、それ以外は記号が一致すれば再利用）
  const patternIdByOldId = new Map<string, string>()
  let patOrder = ctx.existingShiftPatterns.reduce((max, p) => Math.max(max, p.order ?? 0), 0)
  let createdPatterns = 0
  let reusedPatterns = 0
  for (const st of backup.shiftTypes) {
    if (st.fixed) {
      const existing = findExistingFixedPattern(ctx.existingShiftPatterns, st)
      if (existing) {
        patternIdByOldId.set(st.id, existing.id)
        if (!existing.category) {
          const { id: existingId, ...rest } = existing
          void existingId
          await upsertShiftPattern(
            ctx.facilityId,
            existing.id,
            pruneUndefined({ ...rest, category: guessCategory(st) }),
          )
        }
        reusedPatterns++
        continue
      }
    }
    const byCode = ctx.existingShiftPatterns.find((p) => p.code === st.symbol)
    if (byCode) {
      patternIdByOldId.set(st.id, byCode.id)
      reusedPatterns++
      continue
    }
    patOrder += 1
    const id = await upsertShiftPattern(
      ctx.facilityId,
      null,
      pruneUndefined({
        code: st.symbol,
        label: st.name,
        startTime: st.start ?? '',
        endTime: st.end ?? '',
        category: guessCategory(st),
        isWork: st.isWork,
        isNight: st.isNight,
        isSystem: !!st.fixed,
        order: patOrder,
        color: st.color,
        textColor: st.text,
      }),
    )
    patternIdByOldId.set(st.id, id)
    createdPatterns++
  }
  log.push(`勤務パターン: 新規 ${createdPatterns}件 / 既存を再利用 ${reusedPatterns}件`)

  if (ctx.removePlaceholderPatternId) {
    await deleteShiftPattern(ctx.facilityId, ctx.removePlaceholderPatternId)
    log.push('仮登録の勤務パターンを削除しました')
  }

  // 3. 職員（同姓名があれば再利用）
  const staffIdByOldId = new Map<string, string>()
  let staffOrder = ctx.existingStaff.reduce((max, s) => Math.max(max, s.order ?? 0), 0)
  let createdStaff = 0
  let reusedStaff = 0
  for (const s of backup.staff) {
    const existing = ctx.existingStaff.find((e) => e.name === s.name)
    if (existing) {
      staffIdByOldId.set(s.id, existing.id)
      reusedStaff++
      continue
    }
    staffOrder += 1
    const isFullTime = s.employment === '常勤'
    const id = await upsertStaff(ctx.facilityId, null, {
      name: s.name,
      employmentTypeId: employmentIdByLabel.get(s.employment) ?? '',
      active: true,
      order: staffOrder,
      qualifications: s.qualifications ?? [],
      traits: s.traits ?? [],
      workConditions: {
        workablePatternIds: (s.allowedShiftIds ?? [])
          .map((oldId) => patternIdByOldId.get(oldId))
          .filter((v): v is string => !!v),
        maxWorkdaysPerMonth: s.maxDaysPerMonth ?? null,
        // 旧版は「常勤は必要勤務日数の下限も兼ねる」ため、常勤のみ上限と同じ値を下限にも設定する
        targetWorkdaysPerMonth: isFullTime ? (s.maxDaysPerMonth ?? null) : null,
        maxConsecutiveWorkdays: s.maxConsecutive ?? null,
        nightShiftTarget: s.nightShiftTarget ?? null,
      },
    })
    staffIdByOldId.set(s.id, id)
    createdStaff++
  }
  log.push(`職員: 新規 ${createdStaff}名 / 既存（同姓名）を再利用 ${reusedStaff}名`)

  // 4. 条件ルール（対応できない参照先は行ごとスキップ）
  let ruleOrder = 0
  let createdRules = 0
  let skippedRules = 0
  for (const r of backup.rules ?? []) {
    const target = remapRuleTarget(r.target, staffIdByOldId, patternIdByOldId)
    const cond = remapRuleCond(r.cond, patternIdByOldId)
    if (!target || !cond) {
      skippedRules++
      continue
    }
    ruleOrder += 1
    await upsertRule(ctx.facilityId, null, {
      enabled: r.enabled,
      kind: r.strength,
      days: r.days,
      target,
      cond,
      order: ruleOrder,
    })
    createdRules++
  }
  log.push(`条件ルール: 新規 ${createdRules}件${skippedRules > 0 ? `（対応する職員・勤務パターンが見つからず${skippedRules}件をスキップ）` : ''}`)

  // 5. 相性（「普通」は保存しない）
  let createdCompat = 0
  for (const c of backup.compatibility ?? []) {
    if (c.level === 'good') continue
    const a = staffIdByOldId.get(c.a)
    const b = staffIdByOldId.get(c.b)
    if (!a || !b) continue
    await setCompatibility(ctx.facilityId, a, b, c.level)
    createdCompat++
  }
  log.push(`相性: ${createdCompat}件を設定`)

  // 6. 希望休
  let createdWishes = 0
  for (const [oldStaffId, dates] of Object.entries(backup.wishes ?? {})) {
    const staffId = staffIdByOldId.get(oldStaffId)
    if (!staffId) continue
    for (const date of dates) {
      await setWish(ctx.facilityId, staffId, date, date.slice(0, 7), ctx.uid)
      createdWishes++
    }
  }
  log.push(`希望休: ${createdWishes}件を登録`)

  // 7. 設定（settings/shiftRules）
  const m = backup.meta
  await saveShiftRulesSettings(ctx.facilityId, {
    nightMode: m.nightMode ?? null,
    nightAvoidPatternIdsAfter2: (m.nightAvoidShiftAfter2 ?? [])
      .map((oldId) => patternIdByOldId.get(oldId))
      .filter((v): v is string => !!v),
    shiftConsecutiveCaps: Object.fromEntries(
      Object.entries(m.shiftConsecutiveCaps ?? {})
        .map(([oldId, days]) => [patternIdByOldId.get(oldId), days] as const)
        .filter((entry): entry is [string, number] => !!entry[0]),
    ),
    minRestHours: m.minRestHours ?? null,
    preferredFillTimeRange: {
      start: m.preferredFillShift?.start ?? null,
      end: m.preferredFillShift?.end ?? null,
    },
    treatCompatibilityXAsHard: m.compHard ?? null,
    maxConsecutiveWorkdaysDefault: null,
    monthlyLimitsDefault: { targetWorkdays: null, maxWorkdays: null, maxNightShifts: null },
  })
  log.push('設定（夜勤運用・連続日数上限・休息時間など）を反映しました')

  return { log }
}
