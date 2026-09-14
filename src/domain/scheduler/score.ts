/**
 * 6指標スコアリング（旧HTML版 scoreGrid の忠実移植）。
 * docs/remaining-work-design.md §3-5 参照。数式・係数の意味は legacy-html-analysis.md §3 のとおり。
 */
import { parseTimeToHours, weekdayOf } from '../../lib/dateUtils'
import { evalRuleDay, type EvalCtx } from './check'
import { ruleAppliesToDate } from './ruleMatch'
import { demandFor } from './demand'
import type { RuleTextContext } from './ruleText'
import type {
  AssignmentGrid,
  CandidateScores,
  GenerateInput,
  PatternWithId,
  StaffWithId,
} from './types'
import type { GenerationConfig, GenerationProfile } from './defaults'

function stddev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
}

/** 職員が対応できる「日勤の勤務パターン」の集合キー（旧版 dayShiftSetKey 相当） */
function effectiveDayPatternIds(staff: StaffWithId, shiftPatterns: PatternWithId[]): string[] {
  const dayWorkIds = shiftPatterns.filter((p) => p.isWork && !p.isNight).map((p) => p.id)
  const allowed = staff.workConditions?.workablePatternIds
  const ids = !allowed || allowed.length === 0 ? dayWorkIds : dayWorkIds.filter((id) => allowed.includes(id))
  return ids.slice().sort()
}

function patternCountOf(
  staffId: string,
  patternId: string,
  assignments: AssignmentGrid,
  daysInMonth: number,
): number {
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    if (assignments[staffId]?.[String(d)] === patternId) count++
  }
  return count
}

function fairScoreRaw(input: GenerateInput, assignments: AssignmentGrid, coeffs: GenerationConfig['score']['fair']): number {
  const { staff, shiftPatterns, yearMonth, daysInMonth } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))

  const works: number[] = []
  const weekends: number[] = []
  let nightDevSqSum = 0
  let nightDevN = 0

  for (const s of staff) {
    let work = 0
    let night = 0
    let weekend = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const pid = assignments[s.id]?.[String(d)]
      const p = pid ? patternById.get(pid) : undefined
      if (p?.isWork) {
        work++
        if (p.isNight) night++
        const wd = weekdayOf(yearMonth, d)
        if (wd === 0 || wd === 6) weekend++
      }
    }
    works.push(work)
    weekends.push(weekend)
    const target = s.workConditions?.nightShiftTarget
    if (target != null) {
      nightDevSqSum += (night - target) ** 2
      nightDevN++
    }
  }
  const nightDev = nightDevN ? Math.sqrt(nightDevSqSum / nightDevN) : 0

  const groups = new Map<string, StaffWithId[]>()
  for (const s of staff) {
    const key = effectiveDayPatternIds(s, shiftPatterns).join(',')
    if (!key) continue
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  let typeFairSum = 0
  let typeFairN = 0
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const patternIds = effectiveDayPatternIds(members[0], shiftPatterns)
    for (const patternId of patternIds) {
      const counts = members.map((m) => patternCountOf(m.id, patternId, assignments, daysInMonth))
      typeFairSum += stddev(counts)
      typeFairN++
    }
  }
  const typeFairDev = typeFairN ? typeFairSum / typeFairN : 0

  return Math.max(
    0,
    100 -
      (stddev(works) * coeffs.workdaySd +
        nightDev * coeffs.nightTargetDev +
        stddev(weekends) * coeffs.weekendSd +
        typeFairDev * coeffs.typeFairDev),
  )
}

function compScoreRaw(input: GenerateInput, assignments: AssignmentGrid, coeffs: GenerationConfig['score']['comp']): number {
  const { staff, shiftPatterns, compatibilities, daysInMonth } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const levelOf = (a: string, b: string) =>
    compatibilities.find((c) => (c.staffIdA === a && c.staffIdB === b) || (c.staffIdA === b && c.staffIdB === a))
      ?.level ?? null

  let comp = 50
  let pairs = 0
  for (let d = 1; d <= daysInMonth; d++) {
    for (let i = 0; i < staff.length; i++) {
      for (let j = i + 1; j < staff.length; j++) {
        const a = staff[i]
        const b = staff[j]
        const pa = assignments[a.id]?.[String(d)]
        if (!pa) continue
        const pb = assignments[b.id]?.[String(d)]
        if (pa !== pb || !patternById.get(pa)?.isWork) continue
        pairs++
        const level = levelOf(a.id, b.id)
        if (level === 'double') comp += coeffs.double
        else if (level === 'caution') comp += coeffs.caution
        else if (level === 'x') comp += coeffs.x
      }
    }
  }
  return Math.max(0, Math.min(100, pairs ? 50 + ((comp - 50) * 2) / Math.sqrt(pairs) : 70))
}

function wishScore(input: GenerateInput, assignments: AssignmentGrid): number {
  const { wishes, shiftPatterns } = input
  if (wishes.length === 0) return 100
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  let kept = 0
  for (const w of wishes) {
    const pid = assignments[w.staffId]?.[String(w.day)]
    const isWork = !!pid && !!patternById.get(pid)?.isWork
    if (!isWork) kept++
  }
  return Math.round((kept / wishes.length) * 100)
}

function softScore(input: GenerateInput, assignments: AssignmentGrid): number {
  const { staff, shiftPatterns, rules, yearMonth, daysInMonth } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const staffById = new Map(staff.map((s) => [s.id, s]))
  const assignedOf = (staffId: string, day: number) => assignments[staffId]?.[String(day)]
  const isWorkPattern = (pid: string | undefined) => !!pid && !!patternById.get(pid)?.isWork
  const ruleTextCtx: RuleTextContext = {
    shiftLabel: (id) => patternById.get(id)?.label ?? '?',
    staffName: (id) => staffById.get(id)?.name ?? '?',
  }
  const evalCtx: EvalCtx = { staff, patternById, assignedOf, isWorkPattern, ruleTextCtx }

  let total = 0
  let ok = 0
  for (const r of rules) {
    if (!r.enabled || r.kind !== 'soft') continue
    for (let d = 1; d <= daysInMonth; d++) {
      if (!ruleAppliesToDate(r.days, yearMonth, d)) continue
      total++
      if (!evalRuleDay(r, d, evalCtx)) ok++
    }
  }
  return total ? Math.round((ok / total) * 100) : 100
}

function intervalScore(input: GenerateInput, assignments: AssignmentGrid, coeffs: GenerationConfig['score']['interval']): number {
  const { staff, shiftPatterns, settings, daysInMonth } = input
  const minRest = settings.minRestHours
  if (minRest == null) return 100
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))

  let checks = 0
  let penalty = 0
  for (const s of staff) {
    for (let d = 1; d < daysInMonth; d++) {
      const p1 = patternById.get(assignments[s.id]?.[String(d)] ?? '')
      const p2 = patternById.get(assignments[s.id]?.[String(d + 1)] ?? '')
      if (!p1?.isWork || !p2?.isWork || p1.isNight || p2.isNight) continue
      const end1 = parseTimeToHours(p1.endTime)
      const start2 = parseTimeToHours(p2.startTime)
      if (end1 == null || start2 == null) continue
      let gap = 24 - end1 + start2
      if (gap > 24) gap -= 24
      checks++
      if (gap < minRest) penalty += minRest - gap
    }
  }
  return checks ? Math.max(0, Math.round(100 - (penalty / checks) * coeffs.penaltyPerHour)) : 100
}

function spreadScore(input: GenerateInput, assignments: AssignmentGrid, coeffs: GenerationConfig['score']['spread']): number {
  const { staff, shiftPatterns, daysInMonth } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))

  let spreadDevSum = 0
  let spreadN = 0
  let typeDevSum = 0
  let typeDevN = 0

  for (const s of staff) {
    const chunks: { work: number; days: number }[] = []
    const typeWeekly: Record<string, number[]> = {}
    let wi = 0
    for (let start = 1; start <= daysInMonth; start += 7, wi++) {
      const end = Math.min(start + 6, daysInMonth)
      let work = 0
      for (let d = start; d <= end; d++) {
        const pid = assignments[s.id]?.[String(d)]
        const p = pid ? patternById.get(pid) : undefined
        if (p?.isWork && pid) {
          work++
          if (!typeWeekly[pid]) typeWeekly[pid] = []
          typeWeekly[pid][wi] = (typeWeekly[pid][wi] ?? 0) + 1
        }
      }
      chunks.push({ work, days: end - start + 1 })
    }
    const totalWork = chunks.reduce((a, c) => a + c.work, 0)
    const totalDays = chunks.reduce((a, c) => a + c.days, 0)
    if (totalWork) {
      const rate = totalDays ? totalWork / totalDays : 0
      let dev = 0
      chunks.forEach((c) => {
        dev += Math.abs(c.work - rate * c.days)
      })
      spreadDevSum += dev / totalWork
      spreadN++
    }
    const numWeeks = chunks.length
    Object.values(typeWeekly).forEach((arr) => {
      let total = 0
      for (let i = 0; i < numWeeks; i++) total += arr[i] ?? 0
      if (total < 2) return
      const rate = totalDays ? total / totalDays : 0
      let dev = 0
      for (let i = 0; i < numWeeks; i++) dev += Math.abs((arr[i] ?? 0) - rate * chunks[i].days)
      typeDevSum += dev / total
      typeDevN++
    })
  }

  const overallSpread = spreadN ? Math.max(0, 100 - (spreadDevSum / spreadN) * coeffs.overallK) : 100
  const typeSpread = typeDevN ? Math.max(0, 100 - (typeDevSum / typeDevN) * coeffs.typeK) : 100
  return Math.round(overallSpread * coeffs.overallWeight + typeSpread * coeffs.typeWeight)
}

/** 対象月の必要人数に対する充足率（0〜100）。デモ表示用（旧版 fulfillRate 相当） */
export function fulfillmentRate(input: GenerateInput, assignments: AssignmentGrid): number {
  let need = 0
  let met = 0
  for (let d = 1; d <= input.daysInMonth; d++) {
    const dem = demandFor(input.rules, input.yearMonth, d)
    for (const [patternId, count] of Object.entries(dem)) {
      need += count
      const actual = input.staff.filter((s) => assignments[s.id]?.[String(d)] === patternId).length
      met += Math.min(count, actual)
    }
  }
  return need ? Math.round((met / need) * 100) : 100
}

/** 6指標＋総合スコアを計算する（旧版 scoreGrid 相当） */
export function scoreGrid(
  input: GenerateInput,
  assignments: AssignmentGrid,
  profile: GenerationProfile,
): CandidateScores {
  const coeffs = input.config.score
  const fairRaw = fairScoreRaw(input, assignments, coeffs.fair)
  const compRaw = compScoreRaw(input, assignments, coeffs.comp)
  const wish = wishScore(input, assignments)
  const soft = softScore(input, assignments)
  const interval = intervalScore(input, assignments, coeffs.interval)
  const spread = spreadScore(input, assignments, coeffs.spread)

  const w = profile.weights
  const totalWeight = w.fair + w.comp + w.wish + w.soft + w.interval + w.spread
  const total = totalWeight
    ? Math.round(
        (fairRaw * w.fair + compRaw * w.comp + wish * w.wish + soft * w.soft + interval * w.interval + spread * w.spread) /
          totalWeight,
      )
    : 0

  return {
    fair: Math.round(fairRaw),
    comp: Math.round(compRaw),
    wish,
    soft,
    interval,
    spread,
    total,
  }
}
