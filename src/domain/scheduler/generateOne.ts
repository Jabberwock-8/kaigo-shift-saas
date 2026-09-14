/**
 * 1プロファイル分のシフト案を生成する（旧HTML版 generateOne の移植）。
 * docs/remaining-work-design.md §4 のパイプラインに準拠。
 */
import { parseTimeToHours } from '../../lib/dateUtils'
import { canWork } from './canWork'
import { checkMonth } from './check'
import { demandFor } from './demand'
import {
  getCell,
  makeCanWorkContext,
  makeCheckInput,
  setCell,
  shuffle,
  typeCountOf,
  workCountOf,
} from './gridUtils'
import { hillClimb } from './hillClimb'
import { resolveLimits } from './limits'
import { repair } from './repair'
import { fulfillmentRate, scoreGrid } from './score'
import type { AssignmentGrid, Candidate, GenerateInput, PatternWithId, StaffWithId } from './types'
import type { GenerationProfile } from './defaults'

/** 生成に最低限必要な勤務パターン（公休。ake運用なら夜勤明けも）が揃っているか確認する */
export function assertGenerationPrerequisites(input: GenerateInput) {
  const offPattern = input.shiftPatterns.find((p) => p.category === 'off')
  if (!offPattern) {
    throw new Error('勤務パターンに「公休」カテゴリの登録がありません。先に「勤務パターン」で登録してください。')
  }
  if (input.settings.nightMode === 'ake') {
    const afterNight = input.shiftPatterns.find((p) => p.category === 'afterNight')
    if (!afterNight) {
      throw new Error(
        '夜勤明けの扱いが「明を使う」のため、「夜勤明け」カテゴリの勤務パターンが必要です。先に登録してください。',
      )
    }
  }
}

function nightPriority(staff: StaffWithId, nightCountSoFar: Record<string, number>): number {
  const target = staff.workConditions?.nightShiftTarget
  const count = nightCountSoFar[staff.id] ?? 0
  return target != null && count < target ? -1000 + (count - target) : count
}

function restPenaltyFor(
  grid: AssignmentGrid,
  staffId: string,
  day: number,
  patternId: string,
  patternById: Map<string, PatternWithId>,
  minRestHours: number | null,
  penalty: number,
): number {
  if (minRestHours == null || day <= 1) return 0
  const prevId = getCell(grid, staffId, day - 1)
  if (!prevId) return 0
  const prev = patternById.get(prevId)
  const next = patternById.get(patternId)
  if (!prev?.isWork || !next?.isWork || prev.isNight || next.isNight) return 0
  const end1 = parseTimeToHours(prev.endTime)
  const start2 = parseTimeToHours(next.startTime)
  if (end1 == null || start2 == null) return 0
  let gap = 24 - end1 + start2
  if (gap > 24) gap -= 24
  return gap < minRestHours ? penalty : 0
}

function timeDistance(
  pattern: PatternWithId | undefined,
  prefStart: number | null,
  prefEnd: number | null,
): number {
  if (!pattern) return Infinity
  if (prefStart == null || prefEnd == null) return 0
  const s = parseTimeToHours(pattern.startTime)
  const e = parseTimeToHours(pattern.endTime)
  if (s == null || e == null) return Infinity
  return Math.abs(s - prefStart) + Math.abs(e - prefEnd)
}

function fillMinimumWorkdays(grid: AssignmentGrid, input: GenerateInput) {
  const { staff, employmentTypes, settings, daysInMonth, shiftPatterns, monthlyMaxDaysOverride, lockedCells } = input
  const employmentTypeById = new Map(employmentTypes.map((e) => [e.id, e]))
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const offPattern = shiftPatterns.find((p) => p.category === 'off')
  if (!offPattern) return
  const prefStart = parseTimeToHours(settings.preferredFillTimeRange.start)
  const prefEnd = parseTimeToHours(settings.preferredFillTimeRange.end)
  const chunkSize = 7

  for (const s of staff) {
    const limits = resolveLimits(
      s,
      employmentTypeById.get(s.employmentTypeId ?? ''),
      settings,
      monthlyMaxDaysOverride?.[s.id],
    )
    if (limits.targetWorkdays == null) continue
    let current = workCountOf(grid, s.id, daysInMonth, patternById)
    if (current >= limits.targetWorkdays) continue

    // 週(7日)単位でグループ化し、各週から順番に選ぶことで特定週への偏りを防ぐ
    const chunks: number[][] = []
    for (let start = 1; start <= daysInMonth; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, daysInMonth)
      const days: number[] = []
      for (let d = start; d <= end; d++) {
        if (getCell(grid, s.id, d) === offPattern.id && !lockedCells[s.id]?.[String(d)]) days.push(d)
      }
      chunks.push(shuffle(days))
    }
    const orderedDays: number[] = []
    let more = true
    while (more) {
      more = false
      for (const chunk of chunks) {
        if (chunk.length) {
          orderedDays.push(chunk.shift()!)
          more = true
        }
      }
    }

    const allowed = s.workConditions?.workablePatternIds
    const workPatternIds =
      allowed && allowed.length > 0
        ? allowed.filter((id) => {
            const p = patternById.get(id)
            return p?.isWork && !p.isNight
          })
        : shiftPatterns.filter((p) => p.isWork && !p.isNight).map((p) => p.id)

    const weekOf = (d: number) => Math.floor((d - 1) / chunkSize)
    const weekTypeCount: Record<string, number> = {}
    for (let d = 1; d <= daysInMonth; d++) {
      const pid = getCell(grid, s.id, d)
      const p = pid ? patternById.get(pid) : undefined
      if (p?.isWork && pid) {
        const key = `${weekOf(d)}:${pid}`
        weekTypeCount[key] = (weekTypeCount[key] ?? 0) + 1
      }
    }

    for (const d of orderedDays) {
      if (current >= limits.targetWorkdays) break
      const wk = weekOf(d)
      const sortedTypes = [...workPatternIds].sort((a, b) => {
        const scoreA = timeDistance(patternById.get(a), prefStart, prefEnd) + (weekTypeCount[`${wk}:${a}`] ?? 0) * 1.5
        const scoreB = timeDistance(patternById.get(b), prefStart, prefEnd) + (weekTypeCount[`${wk}:${b}`] ?? 0) * 1.5
        return scoreA - scoreB
      })
      for (const patternId of sortedTypes) {
        setCell(grid, s.id, d, null)
        if (canWork(s, d, patternId, makeCanWorkContext(grid, input))) {
          setCell(grid, s.id, d, patternId)
          current++
          weekTypeCount[`${wk}:${patternId}`] = (weekTypeCount[`${wk}:${patternId}`] ?? 0) + 1
          break
        }
        setCell(grid, s.id, d, offPattern.id)
      }
    }
  }
}

export function generateOne(input: GenerateInput, profile: GenerationProfile): Candidate {
  assertGenerationPrerequisites(input)

  const { staff, daysInMonth, yearMonth, shiftPatterns, rules, wishes, lockedCells, baseAssignments, settings, config } =
    input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const offPattern = shiftPatterns.find((p) => p.category === 'off')!
  const afterNightPattern = shiftPatterns.find((p) => p.category === 'afterNight')

  const grid: AssignmentGrid = {}
  for (const s of staff) grid[s.id] = {}

  // 1. seed: ロック済みセルを引き継ぎ、希望休を仮置き
  for (const staffId of Object.keys(lockedCells)) {
    for (const day of Object.keys(lockedCells[staffId])) {
      const v = baseAssignments[staffId]?.[day]
      if (v) setCell(grid, staffId, Number(day), v)
    }
  }
  for (const w of wishes) {
    if (!getCell(grid, w.staffId, w.day)) setCell(grid, w.staffId, w.day, offPattern.id)
  }

  // 2. 夜勤割当
  const nightPatternIds = shiftPatterns.filter((p) => p.isWork && p.isNight).map((p) => p.id)
  const nightCountSoFar: Record<string, number> = {}
  staff.forEach((s) => {
    nightCountSoFar[s.id] = 0
  })

  for (let d = 1; d <= daysInMonth; d++) {
    for (const patternId of nightPatternIds) {
      const need = demandFor(rules, yearMonth, d)[patternId] ?? 0
      let cur = staff.filter((s) => getCell(grid, s.id, d) === patternId).length
      while (cur < need) {
        const candidates = staff
          .filter((s) => canWork(s, d, patternId, makeCanWorkContext(grid, input)))
          .sort((a, b) => nightPriority(a, nightCountSoFar) - nightPriority(b, nightCountSoFar) || Math.random() - 0.5)
        if (!candidates.length) break
        const pick = candidates[Math.floor(Math.random() * Math.min(config.engine.nightPickTopN, candidates.length))]
        setCell(grid, pick.id, d, patternId)
        if (settings.nightMode === 'ake' && afterNightPattern) {
          if (d + 1 <= daysInMonth && !getCell(grid, pick.id, d + 1)) setCell(grid, pick.id, d + 1, afterNightPattern.id)
          if (d + 2 <= daysInMonth && !getCell(grid, pick.id, d + 2)) setCell(grid, pick.id, d + 2, offPattern.id)
        } else if (settings.nightMode === 'direct') {
          if (d + 1 <= daysInMonth && !getCell(grid, pick.id, d + 1)) setCell(grid, pick.id, d + 1, offPattern.id)
        }
        nightCountSoFar[pick.id]++
        cur++
      }
    }
  }

  // 3. 日中割当
  const dayPatternIds = shiftPatterns.filter((p) => p.isWork && !p.isNight).map((p) => p.id)
  for (let d = 1; d <= daysInMonth; d++) {
    const dem = demandFor(rules, yearMonth, d)
    for (const patternId of dayPatternIds) {
      const need = dem[patternId] ?? 0
      let cur = staff.filter((s) => getCell(grid, s.id, d) === patternId).length
      while (cur < need) {
        const candidates = staff
          .filter((s) => canWork(s, d, patternId, makeCanWorkContext(grid, input)))
          .map((s) => ({
            s,
            priority:
              workCountOf(grid, s.id, daysInMonth, patternById) +
              typeCountOf(grid, s.id, patternId, daysInMonth) * config.engine.typeCountWeight +
              restPenaltyFor(grid, s.id, d, patternId, patternById, settings.minRestHours, config.engine.restPenalty),
          }))
          .sort((a, b) => a.priority - b.priority || Math.random() - 0.5)
        if (!candidates.length) break
        const pick = candidates[Math.floor(Math.random() * Math.min(config.engine.dayPickTopN, candidates.length))].s
        setCell(grid, pick.id, d, patternId)
        cur++
      }
    }
  }

  // 4. 空セルは公休で埋める
  for (const s of staff) {
    for (let d = 1; d <= daysInMonth; d++) {
      if (!getCell(grid, s.id, d)) setCell(grid, s.id, d, offPattern.id)
    }
  }

  // 5. 必要出勤日数の補充
  fillMinimumWorkdays(grid, input)

  // 6. 修復
  repair(grid, input)

  // 7. 局所改善
  hillClimb(grid, input, profile, config.engine.hillClimbMs)

  // 8. 再修復 → 採点
  repair(grid, input)

  const check = checkMonth(makeCheckInput(grid, input))
  const scores = scoreGrid(input, grid, profile)

  return {
    profileKey: profile.key,
    label: profile.label,
    weights: profile.weights,
    assignments: grid,
    scores,
    hardCount: check.hardCount,
    softCount: check.softCount,
    hardViolations: check.hard,
    softViolations: check.soft,
    fulfillmentRate: fulfillmentRate(input, grid),
  }
}
