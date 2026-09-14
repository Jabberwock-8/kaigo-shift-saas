import type { AssignmentGrid, CanWorkContext, CheckInput, GenerateInput, PatternWithId } from './types'

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

/** Fisher-Yates。引数の配列をその場でシャッフルして返す */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function makeCanWorkContext(grid: AssignmentGrid, input: GenerateInput): CanWorkContext {
  return {
    grid,
    yearMonth: input.yearMonth,
    daysInMonth: input.daysInMonth,
    patternById: new Map(input.shiftPatterns.map((p) => [p.id, p])),
    employmentTypeById: new Map(input.employmentTypes.map((e) => [e.id, e])),
    settings: input.settings,
    rules: input.rules,
    compatibilities: input.compatibilities,
    monthlyMaxDaysOverride: input.monthlyMaxDaysOverride,
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
