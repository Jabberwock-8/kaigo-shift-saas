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
import { gridViewFor, type GridView, type RowReader } from './gridRows'

/** 勤務パターンの表は入力ごとに変わらないので覚えておく（B2） */
const patternMapCache = new WeakMap<GenerateInput, Map<string, PatternWithId>>()
function patternMapOf(input: GenerateInput): Map<string, PatternWithId> {
  let m = patternMapCache.get(input)
  if (!m) {
    m = new Map(input.shiftPatterns.map((p) => [p.id, p]))
    patternMapCache.set(input, m)
  }
  return m
}

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

function patternCountOf(staffId: string, patternId: string, rd: RowReader, daysInMonth: number): number {
  let count = 0
  const row = rd.row(staffId)
  for (let d = 1; d <= daysInMonth; d++) {
    if (row[d] === patternId) count++
  }
  return count
}

function fairScoreRaw(input: GenerateInput, rd: RowReader, coeffs: GenerationConfig['score']['fair']): number {
  const { staff, shiftPatterns, yearMonth, daysInMonth } = input
  const patternById = patternMapOf(input)

  const works: number[] = []
  const weekends: number[] = []
  let nightDevSqSum = 0
  let nightDevN = 0

  for (const s of staff) {
    let work = 0
    let night = 0
    let weekend = 0
    const row = rd.row(s.id)
    for (let d = 1; d <= daysInMonth; d++) {
      const pid = row[d]
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
      const counts = members.map((m) => patternCountOf(m.id, patternId, rd, daysInMonth))
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

function compScoreRaw(input: GenerateInput, view: GridView, coeffs: GenerationConfig['score']['comp']): number {
  const { daysInMonth } = input
  const rd = view.read
  const patternById = patternMapOf(input)
  // 探索で1手ごとに呼ばれるため、全員の組み合わせを毎日調べるのをやめた（B2）。結果は従来と同じ:
  // - 同じ日に同じ勤務（勤務日の勤務だけ）に入った組の数 = 勤務ごとの人数 n から n(n-1)/2 を足したもの
  // - 相性の点は、相性が登録されている組だけを調べて足す（従来の「職員の組ごとに最初に見つかった相性」と同じ組）
  const pairLevels = compatiblePairLevels(input)

  let comp = 50
  let pairs = 0
  for (let d = 1; d <= daysInMonth; d++) {
    for (const [pid, n] of view.dayCounts(d)) {
      if (pid && n >= 2 && patternById.get(pid)?.isWork) pairs += (n * (n - 1)) / 2
    }
    for (const { a, b, level } of pairLevels) {
      const pa = rd(a, d)
      if (!pa || pa !== rd(b, d) || !patternById.get(pa)?.isWork) continue
      if (level === 'double') comp += coeffs.double
      else if (level === 'caution') comp += coeffs.caution
      else if (level === 'x') comp += coeffs.x
    }
  }
  return Math.max(0, Math.min(100, pairs ? 50 + ((comp - 50) * 2) / Math.sqrt(pairs) : 70))
}

/**
 * 相性の採点で見る組（入力の職員どうし・1組1回・相性の値は従来の find と同じく一覧で最初に見つかったもの）。
 * 入力ごとに変わらないので覚えておく
 */
const pairLevelCache = new WeakMap<GenerateInput, { a: string; b: string; level: string }[]>()
function compatiblePairLevels(input: GenerateInput): { a: string; b: string; level: string }[] {
  const cached = pairLevelCache.get(input)
  if (cached) return cached
  const ids = new Set(input.staff.map((s) => s.id))
  const seen = new Set<string>()
  const out: { a: string; b: string; level: string }[] = []
  for (const c of input.compatibilities) {
    if (c.staffIdA === c.staffIdB || !ids.has(c.staffIdA) || !ids.has(c.staffIdB)) continue
    const key = [c.staffIdA, c.staffIdB].sort().join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ a: c.staffIdA, b: c.staffIdB, level: c.level })
  }
  pairLevelCache.set(input, out)
  return out
}

function wishScore(input: GenerateInput, rd: RowReader): number {
  const { wishes } = input
  if (wishes.length === 0) return 100
  const patternById = patternMapOf(input)
  let kept = 0
  for (const w of wishes) {
    const pid = rd(w.staffId, w.day)
    const isWork = !!pid && !!patternById.get(pid)?.isWork
    if (!isWork) kept++
  }
  return Math.round((kept / wishes.length) * 100)
}

function softScore(input: GenerateInput, view: GridView): number {
  const rd = view.read
  const { staff, rules, yearMonth, daysInMonth } = input
  const patternById = patternMapOf(input)
  const staffById = new Map(staff.map((s) => [s.id, s]))
  const assignedOf = rd
  const isWorkPattern = (pid: string | undefined) => !!pid && !!patternById.get(pid)?.isWork
  const ruleTextCtx: RuleTextContext = {
    shiftLabel: (id) => patternById.get(id)?.label ?? '?',
    staffName: (id) => staffById.get(id)?.name ?? '?',
  }
  const countAssigned = (day: number, patternId: string) => view.dayCounts(day).get(patternId) ?? 0
  const evalCtx: EvalCtx = { staff, patternById, assignedOf, isWorkPattern, ruleTextCtx, countAssigned }

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

function intervalScore(input: GenerateInput, rd: RowReader, coeffs: GenerationConfig['score']['interval']): number {
  const { staff, settings, daysInMonth } = input
  const minRest = settings.minRestHours
  if (minRest == null) return 100
  const patternById = patternMapOf(input)

  let checks = 0
  let penalty = 0
  for (const s of staff) {
    const row = rd.row(s.id)
    for (let d = 1; d < daysInMonth; d++) {
      const p1 = patternById.get(row[d] ?? '')
      const p2 = patternById.get(row[d + 1] ?? '')
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

function spreadScore(input: GenerateInput, rd: RowReader, coeffs: GenerationConfig['score']['spread']): number {
  const { staff, daysInMonth } = input
  const patternById = patternMapOf(input)

  let spreadDevSum = 0
  let spreadN = 0
  let typeDevSum = 0
  let typeDevN = 0

  for (const s of staff) {
    const chunks: { work: number; days: number }[] = []
    const typeWeekly: Record<string, number[]> = {}
    const row = rd.row(s.id)
    let wi = 0
    for (let start = 1; start <= daysInMonth; start += 7, wi++) {
      const end = Math.min(start + 6, daysInMonth)
      let work = 0
      for (let d = start; d <= end; d++) {
        const pid = row[d]
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
  /** 探索の1手で違反チェックと共有する読み取り（B2）。渡さなくても結果は同じ */
  gridView?: GridView,
): CandidateScores {
  const coeffs = input.config.score
  // 勤務の読み取りを6指標で共有する（B2。1回の採点の間は勤務表を書き換えないので結果は同じ）
  const view = gridViewFor(gridView, assignments, input.daysInMonth, input.staff)
  const rd = view.read
  const fairRaw = fairScoreRaw(input, rd, coeffs.fair)
  const compRaw = compScoreRaw(input, view, coeffs.comp)
  const wish = wishScore(input, rd)
  const soft = softScore(input, view)
  const interval = intervalScore(input, rd, coeffs.interval)
  const spread = spreadScore(input, rd, coeffs.spread)

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
