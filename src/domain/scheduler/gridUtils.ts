import { buildDayPatternCaps, type DayPatternCaps } from './caps'
import { buildTraitPairBlocks, type TraitPairBlock } from './traitPairs'
import type { ShiftRulesSettings } from '../../types/models'
import type { AssignmentGrid, CanWorkContext, CheckInput, GenerateInput, PatternWithId } from './types'

/**
 * 自動生成が単独で置いたり動かしたりしてよい日中の勤務か。夜勤と夜勤明けは除く。
 * 夜勤明けは夜勤とセットで置くもので、勤務日として数える施設（明出を勤務扱いにする運用）でも
 * 「余っている勤務」として休みに振り替えたり、別の日へ動かしたり、日数の補充に使ったりしてはいけない
 */
export function isDayWorkPattern(p: Pick<PatternWithId, 'isWork' | 'isNight' | 'category'> | undefined): boolean {
  return !!p?.isWork && !p.isNight && p.category !== 'afterNight'
}

/** 「明」を使う運用で、明の翌日を必ず公休にするか（未設定は従来どおり必須） */
export function akeRequiresOffNextDay(settings: Pick<ShiftRulesSettings, 'akeRequiresOffNextDay'>): boolean {
  return settings.akeRequiresOffNextDay !== false
}

/** 「明」を使う運用で、夜勤の連続（夜→夜→明）を認めるか（未設定は認めない） */
export function akeAllowsConsecutiveNights(settings: Pick<ShiftRulesSettings, 'akeAllowConsecutiveNights'>): boolean {
  return settings.akeAllowConsecutiveNights === true
}

/**
 * 夜勤の前日の決まった勤務（M3 など）として置かれているマスか。修復・局所改善はこのマスを動かさない
 * （動かすと「夜勤前日は M3 が必要」が崩れる）
 */
export function isPreNightCell(
  grid: AssignmentGrid,
  settings: Pick<ShiftRulesSettings, 'nightPrecedingPatternId'>,
  patternById: Map<string, Pick<PatternWithId, 'isNight'>>,
  staffId: string,
  day: number,
): boolean {
  const pre = settings.nightPrecedingPatternId
  if (!pre || grid[staffId]?.[String(day)] !== pre) return false
  return !!patternById.get(grid[staffId]?.[String(day + 1)] ?? '')?.isNight
}

export function getCell(grid: AssignmentGrid, staffId: string, day: number): string | undefined {
  return grid[staffId]?.[String(day)]
}

export function setCell(grid: AssignmentGrid, staffId: string, day: number, patternId: string | null) {
  if (!grid[staffId]) grid[staffId] = {}
  if (patternId) grid[staffId][String(day)] = patternId
  else delete grid[staffId][String(day)]
}

export function workCountOf(
  grid: AssignmentGrid,
  staffId: string,
  daysInMonth: number,
  patternById: Map<string, PatternWithId>,
): number {
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const pid = getCell(grid, staffId, d)
    if (pid && patternById.get(pid)?.isWork) count++
  }
  return count
}

export function nightCountOf(
  grid: AssignmentGrid,
  staffId: string,
  daysInMonth: number,
  patternById: Map<string, PatternWithId>,
): number {
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const pid = getCell(grid, staffId, d)
    if (pid && patternById.get(pid)?.isNight) count++
  }
  return count
}

export function typeCountOf(
  grid: AssignmentGrid,
  staffId: string,
  patternId: string,
  daysInMonth: number,
): number {
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    if (getCell(grid, staffId, d) === patternId) count++
  }
  return count
}

/** 指定日の直前まで何日連続で休み（未配置扱いも含む）だったか。週単位の偏り緩和に使う */
export function consecutiveOffStreakBefore(
  grid: AssignmentGrid,
  staffId: string,
  day: number,
  patternById: Map<string, PatternWithId>,
): number {
  let streak = 0
  for (let d = day - 1; d >= 1; d--) {
    const pid = getCell(grid, staffId, d)
    if (pid && patternById.get(pid)?.isWork) break
    streak++
  }
  return streak
}

/** Fisher-Yates。引数の配列をその場でシャッフルして返す */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * shiftPatterns/employmentTypes から作る Map は同一 input の間は変化しないため、
 * canWork が高頻度に呼ばれる repair/hillClimb での再構築コストを避けるためにキャッシュする。
 */
const patternMapCache = new WeakMap<GenerateInput, Map<string, PatternWithId>>()
const employmentTypeMapCache = new WeakMap<GenerateInput, CanWorkContext['employmentTypeById']>()
const dayPatternCapsCache = new WeakMap<GenerateInput, DayPatternCaps>()
const traitPairBlocksCache = new WeakMap<GenerateInput, TraitPairBlock[]>()
const wishDaysCache = new WeakMap<GenerateInput, Set<string>>()

function cachedPatternById(input: GenerateInput) {
  let m = patternMapCache.get(input)
  if (!m) {
    m = new Map(input.shiftPatterns.map((p) => [p.id, p]))
    patternMapCache.set(input, m)
  }
  return m
}

function cachedEmploymentTypeById(input: GenerateInput) {
  let m = employmentTypeMapCache.get(input)
  if (!m) {
    m = new Map(input.employmentTypes.map((e) => [e.id, e]))
    employmentTypeMapCache.set(input, m)
  }
  return m
}

/** 施設ごとに無効化できるようにしてあるため、切られている間は空マップ（＝上限なし）を返す */
export function cachedDayPatternCaps(input: GenerateInput): DayPatternCaps {
  let m = dayPatternCapsCache.get(input)
  if (!m) {
    m = input.config.engine.enforceDayPatternCaps === false
      ? new Map()
      : buildDayPatternCaps(input.rules, input.yearMonth, input.daysInMonth)
    dayPatternCapsCache.set(input, m)
  }
  return m
}

/** 施設ごとに無効化できるようにしてあるため、切られている間は空（＝チェックしない）を返す */
export function cachedTraitPairBlocks(input: GenerateInput): TraitPairBlock[] {
  let m = traitPairBlocksCache.get(input)
  if (!m) {
    m = input.config.engine.enforceTraitPairs === false ? [] : buildTraitPairBlocks(input.rules, input.staff)
    traitPairBlocksCache.set(input, m)
  }
  return m
}

/** 施設ごとに無効化できるようにしてあるため、切られている間は空（＝チェックしない）を返す */
export function cachedWishDays(input: GenerateInput): Set<string> {
  let m = wishDaysCache.get(input)
  if (!m) {
    m = input.config.engine.enforceWishes === false ? new Set() : new Set(input.wishes.map((w) => `${w.staffId}_${w.day}`))
    wishDaysCache.set(input, m)
  }
  return m
}

export function makeCanWorkContext(grid: AssignmentGrid, input: GenerateInput): CanWorkContext {
  return {
    grid,
    yearMonth: input.yearMonth,
    daysInMonth: input.daysInMonth,
    patternById: cachedPatternById(input),
    employmentTypeById: cachedEmploymentTypeById(input),
    settings: input.settings,
    rules: input.rules,
    compatibilities: input.compatibilities,
    monthlyMaxDaysOverride: input.monthlyMaxDaysOverride,
    dayPatternCaps: cachedDayPatternCaps(input),
    traitPairBlocks: cachedTraitPairBlocks(input),
    wishDays: cachedWishDays(input),
  }
}

export function makeCheckInput(grid: AssignmentGrid, input: GenerateInput): CheckInput {
  return {
    yearMonth: input.yearMonth,
    daysInMonth: input.daysInMonth,
    staff: input.staff,
    employmentTypes: input.employmentTypes,
    shiftPatterns: input.shiftPatterns,
    assignments: grid,
    rules: input.rules,
    compatibilities: input.compatibilities,
    settings: input.settings,
    monthlyMaxDaysOverride: input.monthlyMaxDaysOverride,
  }
}
