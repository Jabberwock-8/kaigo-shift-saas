/**
 * シフト表の違反チェック（旧HTML版 checkMonth 相当）。
 * UI・Firestoreに依存しない純粋なロジック。docs/firestore-design.md §9 の方針どおり、
 * 生成エンジン（Phase 4d）からもこのまま呼び出す想定。
 */
import type { Rule, RuleCond, RuleDays } from '../../types/models'
import { formatDate, weekdayOf } from '../../lib/dateUtils'
import { ruleText, type RuleTextContext } from './ruleText'
import type { CheckInput, CheckResult, PatternWithId, RuleWithId, StaffWithId } from './types'

function ruleAppliesToDate(days: RuleDays, yearMonth: string, day: number): boolean {
  const w = weekdayOf(yearMonth, day)
  switch (days.type) {
    case 'all':
      return true
    case 'weekdays':
      return w >= 1 && w <= 5
    case 'weekend':
      return w === 0 || w === 6
    case 'dow':
      return ((days.values as number[] | undefined) ?? []).includes(w)
    case 'dates':
      return ((days.values as string[] | undefined) ?? []).includes(formatDate(yearMonth, day))
    default:
      return false
  }
}

interface EvalCtx {
  staff: StaffWithId[]
  patternById: Map<string, PatternWithId>
  assignedOf: (staffId: string, day: number) => string | undefined
  isWorkPattern: (patternId: string | undefined) => boolean
  ruleTextCtx: RuleTextContext
}

interface RuleViolation {
  message: string
  cells?: { staffId: string; day: number }[]
}

function evalRuleDay(rule: Rule, day: number, ctx: EvalCtx): RuleViolation | null {
  const { target, cond } = rule
  const label = ruleText(rule, ctx.ruleTextCtx)

  if (target.type === 'shift') {
    const patternId = target.value as string
    const n = ctx.staff.filter((s) => ctx.assignedOf(s.id, day) === patternId).length
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
  const { yearMonth, daysInMonth, staff, shiftPatterns, assignments, rules, compatibilities } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const staffById = new Map(staff.map((s) => [s.id, s]))

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
  const isWorkPattern = (patternId: string | undefined) => !!patternId && !!patternById.get(patternId)?.isWork

  // ---- 職員ごとのチェック（対応可能勤務・固定休み曜日・連続勤務・月間日数・夜勤上限） ----
  for (const s of staff) {
    const wc = s.workConditions ?? {}
    let workCount = 0
    let nightCount = 0
    let consecutive = 0

    for (let d = 1; d <= daysInMonth; d++) {
      const patternId = assignedOf(s.id, d)
      const pattern = patternId ? patternById.get(patternId) : undefined

      if (pattern?.isWork) {
        workCount++
        if (pattern.isNight) nightCount++
        consecutive++

        if (wc.maxConsecutiveWorkdays != null && consecutive > wc.maxConsecutiveWorkdays) {
          hard.push(`${s.name}: 連続勤務が上限${wc.maxConsecutiveWorkdays}日を超過（${d}日時点）`)
          addCell(s.id, d, `連続勤務が上限${wc.maxConsecutiveWorkdays}日を超過`)
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
      } else {
        consecutive = 0
      }
    }

    if (wc.targetWorkdaysPerMonth != null && workCount < wc.targetWorkdaysPerMonth) {
      const msg = `必要出勤日数(${wc.targetWorkdaysPerMonth}日)に届いていません（現在${workCount}日）`
      hard.push(`${s.name}: ${msg}`)
      addStaffMsg(s.id, msg)
    }
    if (wc.maxWorkdaysPerMonth != null && workCount > wc.maxWorkdaysPerMonth) {
      const msg = `最大勤務日数(${wc.maxWorkdaysPerMonth}日)を超過（現在${workCount}日）`
      hard.push(`${s.name}: ${msg}`)
      addStaffMsg(s.id, msg)
    }
    if (wc.maxNightShiftsPerMonth != null && nightCount > wc.maxNightShiftsPerMonth) {
      const msg = `夜勤上限(${wc.maxNightShiftsPerMonth}回)を超過（現在${nightCount}回）`
      hard.push(`${s.name}: ${msg}`)
      addStaffMsg(s.id, msg)
    }
  }

  // ---- 相性×（同一シフトへの同席を禁止） ----
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

  // ---- 条件（ルールビルダー） ----
  const ruleTextCtx: RuleTextContext = {
    shiftLabel: (id) => patternById.get(id)?.label ?? '?',
    staffName: (id) => staffById.get(id)?.name ?? '?',
  }
  const evalCtx: EvalCtx = { staff, patternById, assignedOf, isWorkPattern, ruleTextCtx }

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
