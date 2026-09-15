import { parseTimeToHours, weekdayOf } from '../../lib/dateUtils'
import { resolveLimits } from './limits'
import { ruleAppliesToDate } from './ruleMatch'
import type { CanWorkContext, PatternWithId, StaffWithId } from './types'

/** 前日終業〜当日出勤の休息時間（時間）。夜勤絡み・時刻未設定は対象外でnull */
function restIntervalHours(prev: PatternWithId | undefined, next: PatternWithId | undefined): number | null {
  if (!prev?.isWork || !next?.isWork || prev.isNight || next.isNight) return null
  const end1 = parseTimeToHours(prev.endTime)
  const start2 = parseTimeToHours(next.startTime)
  if (end1 == null || start2 == null) return null
  let gap = 24 - end1 + start2
  if (gap > 24) gap -= 24
  return gap
}

function patternIdAt(ctx: CanWorkContext, staffId: string, day: number): string | undefined {
  if (day < 1 || day > ctx.daysInMonth) return undefined
  return ctx.grid[staffId]?.[String(day)]
}

function isNightAt(ctx: CanWorkContext, staffId: string, day: number): boolean {
  const pid = patternIdAt(ctx, staffId, day)
  return !!pid && !!ctx.patternById.get(pid)?.isNight
}

function isWorkAt(ctx: CanWorkContext, staffId: string, day: number): boolean {
  const pid = patternIdAt(ctx, staffId, day)
  return !!pid && !!ctx.patternById.get(pid)?.isWork
}

function categoryAt(ctx: CanWorkContext, staffId: string, day: number) {
  const pid = patternIdAt(ctx, staffId, day)
  return pid ? ctx.patternById.get(pid)?.category : undefined
}

/**
 * 職員が指定の日に指定の勤務パターンへ配置できるか（旧HTML版 canWork 相当）。
 * 生成エンジン（Phase 4d-2）が候補を絞り込む際の中核判定。docs/remaining-work-design.md §3-4 参照。
 */
export function canWork(
  staff: StaffWithId,
  day: number,
  patternId: string,
  ctx: CanWorkContext,
): boolean {
  const pattern = ctx.patternById.get(patternId)
  if (!pattern) return false

  const wc = staff.workConditions ?? {}

  // 1. 対応可能な勤務パターン（未設定なら全て可）
  const allowed = wc.workablePatternIds
  if (allowed && allowed.length > 0 && !allowed.includes(patternId)) return false

  // 2. 既にその日に割当がある
  if (patternIdAt(ctx, staff.id, day)) return false

  // 3. 固定休み曜日
  const weekday = weekdayOf(ctx.yearMonth, day)
  if ((wc.fixedOffWeekdays ?? []).includes(weekday)) return false

  // 4. 「特定職員を勤務させない」hard ルール
  const forcedOff = ctx.rules.some(
    (r) =>
      r.enabled &&
      r.kind === 'hard' &&
      r.target.type === 'staff' &&
      r.target.value === staff.id &&
      r.cond.type === 'off' &&
      ruleAppliesToDate(r.days, ctx.yearMonth, day),
  )
  if (forcedOff) return false

  // 5. 夜勤ブロック（settings.nightMode 設定時のみ）
  if (ctx.settings.nightMode === 'direct') {
    const prevIsNight = isNightAt(ctx, staff.id, day - 1)
    if (prevIsNight && !pattern.isNight) return false
    if (isNightAt(ctx, staff.id, day - 2) && ctx.settings.nightAvoidPatternIdsAfter2.includes(patternId)) {
      return false
    }
    if (pattern.isNight && patternIdAt(ctx, staff.id, day + 1)) return false
  } else if (ctx.settings.nightMode === 'ake') {
    if (isNightAt(ctx, staff.id, day - 1)) return false
    if (categoryAt(ctx, staff.id, day - 1) === 'afterNight') return false
    if (pattern.isNight) {
      if (patternIdAt(ctx, staff.id, day + 1)) return false
      if (patternIdAt(ctx, staff.id, day + 2)) return false
    }
  }

  // 5.5 休息時間（null/true=必須扱い。false のときだけ推奨(soft)に緩める）
  if (ctx.settings.minRestHours != null && ctx.settings.treatRestHoursAsHard !== false) {
    const minRest = ctx.settings.minRestHours
    const prevPattern = ctx.patternById.get(patternIdAt(ctx, staff.id, day - 1) ?? '')
    const gapBefore = restIntervalHours(prevPattern, pattern)
    if (gapBefore != null && gapBefore < minRest) return false

    const nextPattern = ctx.patternById.get(patternIdAt(ctx, staff.id, day + 1) ?? '')
    const gapAfter = restIntervalHours(pattern, nextPattern)
    if (gapAfter != null && gapAfter < minRest) return false
  }

  const limits = resolveLimits(
    staff,
    ctx.employmentTypeById.get(staff.employmentTypeId ?? ''),
    ctx.settings,
    ctx.monthlyMaxDaysOverride?.[staff.id],
  )

  // 6. 連続勤務上限
  if (limits.maxConsecutive != null) {
    let back = 0
    for (let d = day - 1; d >= 1 && isWorkAt(ctx, staff.id, d); d--) back++
    let fwd = 0
    for (let d = day + 1; d <= ctx.daysInMonth && isWorkAt(ctx, staff.id, d); d++) fwd++
    if (back + 1 + fwd > limits.maxConsecutive) return false
  }

  // 7. パターン別の連続日数上限
  const cap = ctx.settings.shiftConsecutiveCaps[patternId]
  if (cap != null) {
    let back = 0
    for (let d = day - 1; d >= 1 && patternIdAt(ctx, staff.id, d) === patternId; d--) back++
    let fwd = 0
    for (let d = day + 1; d <= ctx.daysInMonth && patternIdAt(ctx, staff.id, d) === patternId; d++) fwd++
    if (back + 1 + fwd > cap) return false
  }

  // 8. 月間上限（勤務日数・夜勤回数）
  let workCount = 0
  let nightCount = 0
  for (let d = 1; d <= ctx.daysInMonth; d++) {
    const pid = patternIdAt(ctx, staff.id, d)
    const p = pid ? ctx.patternById.get(pid) : undefined
    if (p?.isWork) {
      workCount++
      if (p.isNight) nightCount++
    }
  }
  if (limits.maxWorkdays != null && workCount + 1 > limits.maxWorkdays) return false
  if (pattern.isNight && limits.maxNights != null && nightCount + 1 > limits.maxNights) return false

  // 9. 相性×（settings.treatCompatibilityXAsHard !== false のとき）
  if (ctx.settings.treatCompatibilityXAsHard !== false) {
    const xPartnerIds = new Set<string>()
    ctx.compatibilities.forEach((c) => {
      if (c.level !== 'x') return
      if (c.staffIdA === staff.id) xPartnerIds.add(c.staffIdB)
      if (c.staffIdB === staff.id) xPartnerIds.add(c.staffIdA)
    })
    if (xPartnerIds.size > 0) {
      for (const [otherStaffId, days] of Object.entries(ctx.grid)) {
        if (otherStaffId === staff.id || !xPartnerIds.has(otherStaffId)) continue
        if (days[String(day)] === patternId) return false
      }
    }
  }

  return true
}
