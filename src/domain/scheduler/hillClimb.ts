/**
 * 時間制限つきの局所改善（旧HTML版 hillClimb の移植）。
 * docs/remaining-work-design.md §4-7 参照。
 */
import { canWork } from './canWork'
import { withinDayPatternCap } from './caps'
import { checkMonth } from './check'
import { demandFor } from './demand'
import { cachedDayPatternCaps, getCell, makeCanWorkContext, makeCheckInput, setCell, workCountOf } from './gridUtils'
import { resolveLimits } from './limits'
import { scoreGrid } from './score'
import type { AssignmentGrid, GenerateInput } from './types'
import type { GenerationProfile } from './defaults'

export function hillClimb(grid: AssignmentGrid, input: GenerateInput, profile: GenerationProfile, ms: number) {
  const { staff, daysInMonth, yearMonth, shiftPatterns, rules, lockedCells, wishes, employmentTypes, settings, monthlyMaxDaysOverride } =
    input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const employmentTypeById = new Map(employmentTypes.map((e) => [e.id, e]))
  const offPattern = shiftPatterns.find((p) => p.category === 'off')
  if (!offPattern || staff.length === 0) return
  const dayPatternCaps = cachedDayPatternCaps(input)

  const isLocked = (staffId: string, day: number) => !!lockedCells[staffId]?.[String(day)]
  const isWish = (staffId: string, day: number) => wishes.some((w) => w.staffId === staffId && w.day === day)
  const isNightPattern = (id: string | undefined) => !!id && !!patternById.get(id)?.isNight
  const isAfterNight = (id: string | undefined) => !!id && patternById.get(id)?.category === 'afterNight'
  const workableOf = (staffId: string) => staff.find((s) => s.id === staffId)?.workConditions?.workablePatternIds
  const targetWorkdaysOf = (staffId: string) => {
    const s = staff.find((x) => x.id === staffId)
    if (!s) return null
    return resolveLimits(
      s,
      employmentTypeById.get(s.employmentTypeId ?? ''),
      settings,
      monthlyMaxDaysOverride?.[staffId],
    ).targetWorkdays
  }
  /**
   * 必要出勤日数をすでに満たしている職員から勤務日を1日取り上げる交換は許可しない。
   * hillClimbは必須違反の「件数」しか見ないため、無策だと「出勤日数の未達」が
   * 別の必須違反（連続勤務上限など）と入れ替わってしまうことがある。
   * パート等で「決まった日数を必ず入れてほしい」職員がいるため、この違反は
   * 一度満たしたら手放さない（達成前の職員がさらに減る移動は従来通り許可する）。
   */
  const wouldDropBelowTarget = (staffId: string, losingWorkday: boolean) => {
    if (!losingWorkday) return false
    const target = targetWorkdaysOf(staffId)
    if (target == null) return false
    const current = workCountOf(grid, staffId, daysInMonth, patternById)
    return current - 1 < target
  }

  const evaluate = () => {
    const chk = checkMonth(makeCheckInput(grid, input))
    const sc = scoreGrid(input, grid, profile).total
    return { hardCount: chk.hardCount, total: sc }
  }

  let current = evaluate()
  const end = Date.now() + ms

  const evalMove = (revert: () => void) => {
    const next = evaluate()
    if (next.hardCount < current.hardCount || (next.hardCount === current.hardCount && next.total > current.total)) {
      current = next
      return
    }
    revert()
  }

  while (Date.now() < end) {
    const d = 1 + Math.floor(Math.random() * daysInMonth)
    const roll = Math.random()

    if (roll < 0.35) {
      // 休みの日を別の日の勤務と入れ替える
      const p = staff[Math.floor(Math.random() * staff.length)]
      const d2 = 1 + Math.floor(Math.random() * daysInMonth)
      if (d === d2) continue
      const s1 = getCell(grid, p.id, d)
      const s2 = getCell(grid, p.id, d2)
      if (s1 !== offPattern.id || !s2) continue
      const p2 = patternById.get(s2)
      if (!p2?.isWork || p2.isNight) continue
      if (isLocked(p.id, d) || isLocked(p.id, d2)) continue
      if (isWish(p.id, d)) continue
      const prev = d > 1 ? getCell(grid, p.id, d - 1) : undefined
      if (isAfterNight(prev) || isNightPattern(prev)) continue
      // この移動だけ canWork を通らないため、人数上限は自前で見る（移動Bは同日内の交換で
      // パターン別人数が変わらないため不要、移動Cは canWork 経由で効く）
      if (
        !withinDayPatternCap(dayPatternCaps, d, s2, () =>
          staff.reduce((n, q) => (getCell(grid, q.id, d) === s2 ? n + 1 : n), 0),
        )
      ) {
        continue
      }

      setCell(grid, p.id, d, s2)
      setCell(grid, p.id, d2, offPattern.id)
      evalMove(() => {
        setCell(grid, p.id, d, offPattern.id)
        setCell(grid, p.id, d2, s2)
      })
      continue
    }

    if (roll < 0.65) {
      // 同日の2人のシフトを交換
      const a = staff[Math.floor(Math.random() * staff.length)]
      const b = staff[Math.floor(Math.random() * staff.length)]
      if (!a || !b || a.id === b.id) continue
      if (isLocked(a.id, d) || isLocked(b.id, d)) continue
      const sa = getCell(grid, a.id, d)
      const sb = getCell(grid, b.id, d)
      if (sa === sb) continue

      const patA = workableOf(a.id)
      const patB = workableOf(b.id)
      if (sb && patternById.get(sb)?.isWork && patA && patA.length > 0 && !patA.includes(sb)) continue
      if (sa && patternById.get(sa)?.isWork && patB && patB.length > 0 && !patB.includes(sa)) continue
      if (isAfterNight(sa) || isAfterNight(sb)) continue
      if (isNightPattern(sa) || isNightPattern(sb)) continue

      const pa = d > 1 ? getCell(grid, a.id, d - 1) : undefined
      const pb = d > 1 ? getCell(grid, b.id, d - 1) : undefined
      if (isAfterNight(pa) || isAfterNight(pb)) continue
      if (isNightPattern(pa) || isNightPattern(pb)) continue

      const workA = !!sa && !!patternById.get(sa)?.isWork
      const workB = !!sb && !!patternById.get(sb)?.isWork
      if (workA !== workB) {
        if (wouldDropBelowTarget(a.id, workA) || wouldDropBelowTarget(b.id, workB)) continue
      }

      setCell(grid, a.id, d, sb ?? null)
      setCell(grid, b.id, d, sa ?? null)
      evalMove(() => {
        setCell(grid, a.id, d, sa ?? null)
        setCell(grid, b.id, d, sb ?? null)
      })
    } else {
      // 不足シフトに休みの職員を充てる
      const dem = demandFor(rules, yearMonth, d)
      const shorts = Object.keys(dem).filter(
        (patternId) => staff.filter((s) => getCell(grid, s.id, d) === patternId).length < dem[patternId],
      )
      if (!shorts.length) continue
      const patternId = shorts[Math.floor(Math.random() * shorts.length)]
      if (patternById.get(patternId)?.isNight) continue

      let offs = staff.filter((s) => getCell(grid, s.id, d) === offPattern.id && !isLocked(s.id, d))
      if (!offs.length) continue
      const nonWish = offs.filter((s) => !isWish(s.id, d))
      if (nonWish.length) offs = nonWish

      const p = offs[Math.floor(Math.random() * offs.length)]
      setCell(grid, p.id, d, null)
      if (!canWork(p, d, patternId, makeCanWorkContext(grid, input))) {
        setCell(grid, p.id, d, offPattern.id)
        continue
      }
      setCell(grid, p.id, d, patternId)
      evalMove(() => {
        setCell(grid, p.id, d, offPattern.id)
      })
    }
  }
}
