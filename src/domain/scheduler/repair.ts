/**
 * 必要人数の不足を解消する修復ロジック（旧HTML版 repair / repairGroups の移植）。
 * docs/remaining-work-design.md §4-6 参照。
 */
import { canWork } from './canWork'
import { demandFor } from './demand'
import { getCell, makeCanWorkContext, setCell, workCountOf } from './gridUtils'
import { ruleAppliesToDate } from './ruleMatch'
import type { AssignmentGrid, GenerateInput, StaffWithId } from './types'

function tryAssign(
  grid: AssignmentGrid,
  input: GenerateInput,
  staff: StaffWithId,
  day: number,
  patternId: string,
): boolean {
  if (canWork(staff, day, patternId, makeCanWorkContext(grid, input))) {
    setCell(grid, staff.id, day, patternId)
    return true
  }
  return false
}

export function repair(grid: AssignmentGrid, input: GenerateInput) {
  const { staff, daysInMonth, yearMonth, rules, shiftPatterns, lockedCells, wishes, config } = input
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const offPattern = shiftPatterns.find((p) => p.category === 'off')
  if (!offPattern) return
  const isLocked = (staffId: string, day: number) => !!lockedCells[staffId]?.[String(day)]
  const isWish = (staffId: string, day: number) => wishes.some((w) => w.staffId === staffId && w.day === day)

  // 条件を満たせないデータでは反復回数の上限だけでは体感フリーズし得るため、実時間でも打ち切る
  const deadline = Date.now() + config.engine.repairMaxMs

  for (let iter = 0; iter < config.engine.repairMaxIter; iter++) {
    if (Date.now() > deadline) break
    let fixed = false
    const order =
      iter % 2
        ? Array.from({ length: daysInMonth }, (_, i) => daysInMonth - i)
        : Array.from({ length: daysInMonth }, (_, i) => i + 1)

    for (const d of order) {
      if (fixed) break
      const dem = demandFor(rules, yearMonth, d)

      for (const patternId of Object.keys(dem)) {
        const cur = staff.filter((s) => getCell(grid, s.id, d) === patternId).length
        if (cur >= dem[patternId]) continue

        // ① 休みの職員を充当（希望休の人・勤務数多い人を後回し）
        const offs = staff
          .filter((s) => getCell(grid, s.id, d) === offPattern.id && !isLocked(s.id, d))
          .sort((a, b) => {
            const wa = isWish(a.id, d) ? 1 : 0
            const wb = isWish(b.id, d) ? 1 : 0
            return (
              wa - wb ||
              workCountOf(grid, a.id, daysInMonth, patternById) - workCountOf(grid, b.id, daysInMonth, patternById) ||
              Math.random() - 0.5
            )
          })
        for (const s of offs) {
          setCell(grid, s.id, d, null)
          if (tryAssign(grid, input, s, d, patternId)) {
            fixed = true
            break
          }
          setCell(grid, s.id, d, offPattern.id)
        }
        if (fixed) break

        // ② 同日の余剰パターンから付替え
        const surplus = staff.filter((s) => {
          const pid = getCell(grid, s.id, d)
          if (!pid) return false
          const p = patternById.get(pid)
          if (!p?.isWork || p.isNight) return false
          if (isLocked(s.id, d)) return false
          const cnt = staff.filter((q) => getCell(grid, q.id, d) === pid).length
          return cnt > (dem[pid] ?? 0)
        })
        for (const s of surplus) {
          const old = getCell(grid, s.id, d)!
          setCell(grid, s.id, d, null)
          if (tryAssign(grid, input, s, d, patternId)) {
            fixed = true
            break
          }
          setCell(grid, s.id, d, old)
        }
        if (fixed) break

        // ③ 2手修復: 別日の余剰勤務を休に振替 → 空いた職員を充当
        let twoHandFixed = false
        for (const s of offs) {
          for (let d2 = 1; d2 <= daysInMonth && !twoHandFixed; d2++) {
            if (d2 === d) continue
            const pid2 = getCell(grid, s.id, d2)
            if (!pid2) continue
            const p2 = patternById.get(pid2)
            if (!p2?.isWork || p2.isNight) continue
            if (isLocked(s.id, d2)) continue
            const dem2 = demandFor(rules, yearMonth, d2)
            const cnt2 = staff.filter((q) => getCell(grid, q.id, d2) === pid2).length
            if (cnt2 <= (dem2[pid2] ?? 0)) continue

            setCell(grid, s.id, d2, offPattern.id)
            setCell(grid, s.id, d, null)
            if (tryAssign(grid, input, s, d, patternId)) {
              twoHandFixed = true
              break
            }
            setCell(grid, s.id, d, offPattern.id)
            setCell(grid, s.id, d2, pid2)
          }
          if (twoHandFixed) break
        }
        if (twoHandFixed) {
          fixed = true
          break
        }
      }
    }
    if (!fixed) break
  }

  repairGroups(grid, input)
}

/** shiftGroup 系 hard ルールの atLeastGroup 不足補充 / notTogetherGroup の後勝ち解消 */
export function repairGroups(grid: AssignmentGrid, input: GenerateInput) {
  const { staff, daysInMonth, yearMonth, rules, config, lockedCells } = input
  const patternById = new Map(input.shiftPatterns.map((p) => [p.id, p]))
  const isLocked = (staffId: string, day: number) => !!lockedCells[staffId]?.[String(day)]
  const groupRules = rules.filter((r) => r.enabled && r.kind === 'hard' && r.target.type === 'shiftGroup')
  if (!groupRules.length) return

  const deadline = Date.now() + config.engine.groupRepairMaxMs

  for (let iter = 0; iter < config.engine.groupRepairMaxIter; iter++) {
    if (Date.now() > deadline) return
    let fixed = false
    for (const r of groupRules) {
      const ids = (r.target.value as string[] | undefined) ?? []
      for (let d = 1; d <= daysInMonth; d++) {
        if (!ruleAppliesToDate(r.days, yearMonth, d)) continue
        const counts = ids.map((id) => staff.filter((s) => getCell(grid, s.id, d) === id).length)
        const total = counts.reduce((a, b) => a + b, 0)
        const activeTypes = counts.filter((c) => c > 0).length

        if (r.cond.type === 'atLeastGroup' && total < (r.cond.count ?? 0)) {
          const offPattern = input.shiftPatterns.find((p) => p.category === 'off')
          if (!offPattern) continue
          const offs = staff
            .filter((s) => getCell(grid, s.id, d) === offPattern.id && !isLocked(s.id, d))
            .sort((a, b) => workCountOf(grid, a.id, daysInMonth, patternById) - workCountOf(grid, b.id, daysInMonth, patternById) || Math.random() - 0.5)
          let done = false
          for (const s of offs) {
            for (const id of ids) {
              setCell(grid, s.id, d, null)
              if (tryAssign(grid, input, s, d, id)) {
                done = true
                fixed = true
                break
              }
              setCell(grid, s.id, d, offPattern.id)
            }
            if (done) break
          }
        }

        if (r.cond.type === 'notTogetherGroup' && activeTypes > 1) {
          const offPattern = input.shiftPatterns.find((p) => p.category === 'off')
          let keepDone = false
          for (const id of ids) {
            const holders = staff.filter((s) => getCell(grid, s.id, d) === id && !isLocked(s.id, d))
            if (holders.length === 0) continue
            if (keepDone) {
              holders.forEach((s) => {
                setCell(grid, s.id, d, offPattern ? offPattern.id : null)
                fixed = true
              })
            } else {
              keepDone = true
            }
          }
        }
      }
    }
    if (!fixed) return
  }
}
