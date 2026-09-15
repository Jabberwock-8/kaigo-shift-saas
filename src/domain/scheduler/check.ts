/**
 * シフト表の違反チェック（旧HTML版 checkMonth 相当）。
 * UI・Firestoreに依存しない純粋なロジック。docs/firestore-design.md §9 の方針どおり、
 * 生成エンジン（Phase 4d）からもこのまま呼び出す想定。
 */
import type { Rule, RuleCond } from '../../types/models'
import { parseTimeToHours, weekdayOf } from '../../lib/dateUtils'
import { ruleText, type RuleTextContext } from './ruleText'
import { resolveLimits } from './limits'
import { ruleAppliesToDate } from './ruleMatch'
import type { CheckInput, CheckResult, PatternWithId, RuleWithId, StaffWithId } from './types'

/**
 * ルール1件・1日分を評価するための文脈。
 * score.ts（Phase 4d-1）が「推奨ルール充足率」を計算する際にも再利用する
 * （評価ロジックを二重実装しないため）。
 */
export interface EvalCtx {
  staff: StaffWithId[]
  patternById: Map<string, PatternWithId>
  assignedOf: (staffId: string, day: number) => string | undefined
  /** 生活相談員などの兼務行（secondaryShift ターゲットの評価にだけ使う）。未対応の呼び出し元ではundefinedのままでよい */
  assignedOfSecondary?: (staffId: string, day: number) => string | undefined
  isWorkPattern: (patternId: string | undefined) => boolean
  ruleTextCtx: RuleTextContext
}

export interface RuleViolation {
  message: string
  cells?: { staffId: string; day: number }[]
}

export function evalRuleDay(rule: Rule, day: number, ctx: EvalCtx): RuleViolation | null {
  const { target, cond } = rule
  const label = ruleText(rule, ctx.ruleTextCtx)

  if (target.type === 'shift') {
    const patternId = target.value as string
    const n = ctx.staff.filter((s) => ctx.assignedOf(s.id, day) === patternId).length
    return countViolation(cond, n, label)
  }

  if (target.type === 'secondaryShift') {
    const patternId = target.value as string
    const n = ctx.staff.filter((s) => ctx.assignedOfSecondary?.(s.id, day) === patternId).length
    return countViolation(cond, n, label)
  }

  if (target.type === 'qualification' || target.type === 'trait') {
    const value = target.value as string
    const working = ctx.staff.filter((s) => ctx.isWorkPattern(ctx.assignedOf(s.id, day)))
    const has = (s: StaffWithId) =>
      target.type === 'qualification'
        ? (s.qualifications ?? []).includes(value)
        : (s.traits ?? []).includes(value)
    const n = working.filter(has).length
    return countViolation(cond, n, label)
  }

  if (target.type === 'staff') {
    const staffId = target.value as string
    const pid = ctx.assignedOf(staffId, day)
    const isW = ctx.isWorkPattern(pid)
    if (cond.type === 'work' && !isW) return { message: label, cells: [{ staffId, day }] }
    if (cond.type === 'off' && isW) return { message: label, cells: [{ staffId, day }] }
    if (cond.type === 'preferShift' && isW && pid !== cond.value) {
      const cur = ctx.patternById.get(pid ?? '')?.label ?? pid
      return { message: `${label}（現在${cur}）`, cells: [{ staffId, day }] }
    }
    return null
  }

  if (target.type === 'shiftGroup') {
    const ids = (target.value as string[] | undefined) ?? []
    const counts = ids.map((id) => ctx.staff.filter((s) => ctx.assignedOf(s.id, day) === id).length)
    const total = counts.reduce((a, b) => a + b, 0)
    const activeTypes = counts.filter((c) => c > 0).length
    if (cond.type === 'atLeastGroup' && total < (cond.count ?? 0)) {
      return { message: `${label}（現在${total}名）` }
    }
    if (cond.type === 'notTogetherGroup' && activeTypes > 1) {
      const cells: { staffId: string; day: number }[] = []
      ids.forEach((id) => {
        ctx.staff
          .filter((s) => ctx.assignedOf(s.id, day) === id)
          .forEach((s) => cells.push({ staffId: s.id, day }))
      })
      return { message: label, cells }
    }
    return null
  }

  if (target.type === 'traitPair') {
    const working = ctx.staff.filter((s) => ctx.isWorkPattern(ctx.assignedOf(s.id, day)))
    const groupA = working.filter((s) => (s.traits ?? []).includes(target.value as string))
    const groupB = working.filter((s) => (s.traits ?? []).includes(target.value2 as string))
    if (cond.type === 'together') {
      const bad = groupA.filter(
        (a) => !groupB.some((b) => b.id !== a.id && ctx.assignedOf(b.id, day) === ctx.assignedOf(a.id, day)),
      )
      if (bad.length) {
        return {
          message: `${label}（${bad.map((p) => p.name).join('、')}が単独）`,
          cells: bad.map((p) => ({ staffId: p.id, day })),
        }
      }
    }
    if (cond.type === 'notTogether') {
      const cells: { staffId: string; day: number }[] = []
      groupA.forEach((a) =>
        groupB.forEach((b) => {
          if (a.id !== b.id && ctx.assignedOf(a.id, day) === ctx.assignedOf(b.id, day)) {
            cells.push({ staffId: a.id, day })
            cells.push({ staffId: b.id, day })
          }
        }),
      )
      if (cells.length) return { message: label, cells }
    }
    return null
  }

  return null
}

function countViolation(cond: RuleCond, n: number, label: string): RuleViolation | null {
  if (cond.type === 'exact' && n !== cond.count) return { message: `${label}（現在${n}名）` }
  if (cond.type === 'atLeast' && n < (cond.count ?? 0)) return { message: `${label}（現在${n}名）` }
  if (cond.type === 'atMost' && n > (cond.count ?? 0)) return { message: `${label}（現在${n}名）` }
  if (cond.type === 'none' && n > 0) return { message: label }
  return null
}

export function checkMonth(input: CheckInput): CheckResult {
  const {
    yearMonth,
    daysInMonth,
    staff,
    employmentTypes,
    shiftPatterns,
    assignments,
    secondaryAssignments,
    rules,
    compatibilities,
    settings,
    monthlyMaxDaysOverride,
  } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const staffById = new Map(staff.map((s) => [s.id, s]))
  const employmentTypeById = new Map(employmentTypes.map((e) => [e.id, e]))

  const cellMessages: Record<string, Record<number, string[]>> = {}
  const staffMessages: Record<string, string[]> = {}
  const hard: string[] = []
  const soft: string[] = []

  const addCell = (staffId: string, day: number, msg: string) => {
    if (!cellMessages[staffId]) cellMessages[staffId] = {}
    if (!cellMessages[staffId][day]) cellMessages[staffId][day] = []
    cellMessages[staffId][day].push(msg)
  }
  const addStaffMsg = (staffId: string, msg: string) => {
    if (!staffMessages[staffId]) staffMessages[staffId] = []
    staffMessages[staffId].push(msg)
  }

  const assignedOf = (staffId: string, day: number) => assignments[staffId]?.[String(day)]
  const assignedOfSecondary = (staffId: string, day: number) => secondaryAssignments?.[staffId]?.[String(day)]
  const patternOf = (staffId: string, day: number) => {
    const id = assignedOf(staffId, day)
    return id ? patternById.get(id) : undefined
  }
  const isWorkPattern = (patternId: string | undefined) => !!patternId && !!patternById.get(patternId)?.isWork

  // ---- 職員ごとのチェック ----
  for (const s of staff) {
    const wc = s.workConditions ?? {}
    const limits = resolveLimits(
      s,
      employmentTypeById.get(s.employmentTypeId ?? ''),
      settings,
      monthlyMaxDaysOverride?.[s.id],
    )

    let workCount = 0
    let nightCount = 0
    let consecutive = 0
    const consecutiveByPattern: Record<string, number> = {}

    for (let d = 1; d <= daysInMonth; d++) {
      const patternId = assignedOf(s.id, d)
      const pattern = patternId ? patternById.get(patternId) : undefined

      if (pattern?.isWork) {
        workCount++
        if (pattern.isNight) nightCount++
        consecutive++

        if (limits.maxConsecutive != null && consecutive > limits.maxConsecutive) {
          hard.push(`${s.name}: 連続勤務が上限${limits.maxConsecutive}日を超過（${d}日時点）`)
          addCell(s.id, d, `連続勤務が上限${limits.maxConsecutive}日を超過`)
        }

        const allowed = wc.workablePatternIds
        if (allowed && allowed.length > 0 && !allowed.includes(pattern.id)) {
          hard.push(`${s.name}: ${d}日 対応外の勤務（${pattern.label}）`)
          addCell(s.id, d, '対応外の勤務')
        }

        const weekday = weekdayOf(yearMonth, d)
        if ((wc.fixedOffWeekdays ?? []).includes(weekday)) {
          hard.push(`${s.name}: ${d}日 固定休みの曜日に勤務`)
          addCell(s.id, d, '固定休みの曜日に勤務')
        }

        // パターン別の連続日数上限
        for (const pid of Object.keys(settings.shiftConsecutiveCaps)) {
          if (patternId === pid) {
            consecutiveByPattern[pid] = (consecutiveByPattern[pid] ?? 0) + 1
            const cap = settings.shiftConsecutiveCaps[pid]
            if (consecutiveByPattern[pid] > cap) {
              const capLabel = patternById.get(pid)?.label ?? pid
              hard.push(`${s.name}: ${capLabel}の連続が上限${cap}日を超過（${d}日時点）`)
              addCell(s.id, d, `${capLabel}の連続が上限${cap}日を超過`)
            }
          } else {
            consecutiveByPattern[pid] = 0
          }
        }
      } else {
        consecutive = 0
        Object.keys(consecutiveByPattern).forEach((pid) => {
          consecutiveByPattern[pid] = 0
        })
      }

      // ---- 夜勤ブロックの整合性（settings.nightMode 設定時のみ） ----
      if (settings.nightMode === 'ake') {
        if (pattern?.category === 'afterNight') {
          const prevPattern = d > 1 ? patternOf(s.id, d - 1) : undefined
          if (!prevPattern?.isNight) {
            hard.push(`${s.name}: ${d}日 夜勤なしの「明」`)
            addCell(s.id, d, '夜勤なしの明')
          }
        }
        if (pattern?.isNight) {
          const nextPattern = d + 1 <= daysInMonth ? patternOf(s.id, d + 1) : undefined
          if (d + 1 <= daysInMonth && nextPattern?.category !== 'afterNight') {
            hard.push(`${s.name}: ${d + 1}日 夜勤翌日は「明」が必要`)
            addCell(s.id, d + 1, '夜勤翌日は明が必要')
          } else if (d + 2 <= daysInMonth) {
            const next2Pattern = patternOf(s.id, d + 2)
            if (next2Pattern?.category !== 'off') {
              hard.push(`${s.name}: ${d + 2}日 明の翌日は「休」が必要`)
              addCell(s.id, d + 2, '明の翌日は休が必要')
            }
          }
        }
      } else if (settings.nightMode === 'direct') {
        const prevPattern = d > 1 ? patternOf(s.id, d - 1) : undefined
        const prevWasNight = !!prevPattern?.isNight
        if (pattern?.isNight && !prevWasNight) {
          // 夜勤ブロックの開始日。終端 e を探す
          let e = d
          while (e + 1 <= daysInMonth && patternOf(s.id, e + 1)?.isNight) e++
          if (e + 1 <= daysInMonth) {
            const nextPattern = patternOf(s.id, e + 1)
            if (nextPattern?.isWork) {
              hard.push(`${s.name}: ${e + 1}日 夜勤翌日は休みが必要`)
              addCell(s.id, e + 1, '夜勤翌日は休みが必要')
            } else if (e + 2 <= daysInMonth) {
              const next2Id = assignedOf(s.id, e + 2)
              if (next2Id && settings.nightAvoidPatternIdsAfter2.includes(next2Id)) {
                const avoidLabel = patternById.get(next2Id)?.label ?? next2Id
                hard.push(`${s.name}: ${e + 2}日 夜勤の2日後に${avoidLabel}は避ける`)
                addCell(s.id, e + 2, `夜勤の2日後に${avoidLabel}は避ける`)
              }
            }
          }
        }
      }

      // ---- 休息時間（既定は推奨(soft)。treatRestHoursAsHard=true なら必須(hard)扱い） ----
      if (settings.minRestHours != null && d < daysInMonth) {
        const p1 = patternOf(s.id, d)
        const p2 = patternOf(s.id, d + 1)
        if (p1?.isWork && p2?.isWork && !p1.isNight && !p2.isNight) {
          const end1 = parseTimeToHours(p1.endTime)
          const start2 = parseTimeToHours(p2.startTime)
          if (end1 != null && start2 != null) {
            let gap = 24 - end1 + start2
            if (gap > 24) gap -= 24
            if (gap < settings.minRestHours) {
              const msg = `${s.name}: ${d}〜${d + 1}日 休息時間が${gap.toFixed(1)}時間しかありません（${p1.label} ${p1.endTime}終業→${p2.label} ${p2.startTime}出勤）`
              if (settings.treatRestHoursAsHard !== false) {
                hard.push(msg)
                addCell(s.id, d, '休息時間不足')
                addCell(s.id, d + 1, '休息時間不足')
              } else {
                soft.push(msg)
              }
            }
          }
        }
      }
    }

    if (limits.targetWorkdays != null && workCount < limits.targetWorkdays) {
      const msg = `必要出勤日数(${limits.targetWorkdays}日)に届いていません（現在${workCount}日）`
      hard.push(`${s.name}: ${msg}`)
      addStaffMsg(s.id, msg)
    }
    if (limits.maxWorkdays != null && workCount > limits.maxWorkdays) {
      const msg = `最大勤務日数(${limits.maxWorkdays}日)を超過（現在${workCount}日）`
      hard.push(`${s.name}: ${msg}`)
      addStaffMsg(s.id, msg)
    }
    if (limits.maxNights != null && nightCount > limits.maxNights) {
      const msg = `夜勤上限(${limits.maxNights}回)を超過（現在${nightCount}回）`
      hard.push(`${s.name}: ${msg}`)
      addStaffMsg(s.id, msg)
    }
  }

  // ---- 相性×（同一シフトへの同席を禁止。settings.treatCompatibilityXAsHard===false なら判定しない） ----
  if (settings.treatCompatibilityXAsHard !== false) {
    for (const c of compatibilities) {
      if (c.level !== 'x') continue
      for (let d = 1; d <= daysInMonth; d++) {
        const pa = assignedOf(c.staffIdA, d)
        const pb = assignedOf(c.staffIdB, d)
        if (pa && pa === pb && isWorkPattern(pa)) {
          const nameA = staffById.get(c.staffIdA)?.name ?? '?'
          const nameB = staffById.get(c.staffIdB)?.name ?? '?'
          hard.push(`${d}日: 相性×の${nameA}と${nameB}が同一シフト`)
          addCell(c.staffIdA, d, '相性×ペアと同一シフト')
          addCell(c.staffIdB, d, '相性×ペアと同一シフト')
        }
      }
    }
  }

  // ---- 条件（ルールビルダー） ----
  const ruleTextCtx: RuleTextContext = {
    shiftLabel: (id) => patternById.get(id)?.label ?? '?',
    staffName: (id) => staffById.get(id)?.name ?? '?',
  }
  const evalCtx: EvalCtx = { staff, patternById, assignedOf, assignedOfSecondary, isWorkPattern, ruleTextCtx }

  const enabledRules: RuleWithId[] = rules.filter((r) => r.enabled)
  for (const r of enabledRules) {
    for (let d = 1; d <= daysInMonth; d++) {
      if (!ruleAppliesToDate(r.days, yearMonth, d)) continue
      const violation = evalRuleDay(r, d, evalCtx)
      if (!violation) continue
      const msg = `${d}日: ${violation.message}`
      if (r.kind === 'hard') {
        hard.push(msg)
        violation.cells?.forEach((c) => addCell(c.staffId, c.day, violation.message))
      } else {
        soft.push(msg)
      }
    }
  }

  return {
    cellMessages,
    staffMessages,
    hard,
    soft,
    hardCount: hard.length,
    softCount: soft.length,
  }
}
