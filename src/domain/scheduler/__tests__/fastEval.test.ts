import { describe, expect, it } from 'vitest'
import { checkMonth } from '../check'
import { scoreGrid } from '../score'
import { makeCheckInput } from '../gridUtils'
import { makeGridView, makeRowReader } from '../gridRows'
import { createSeededRandom } from '../random'
import { weekdayOf } from '../../../lib/dateUtils'
import type { AssignmentGrid, CompatibilityWithId, GenerateInput } from '../types'
import { BENCH_FACILITIES } from './fixtures/facilities'

// 改善指示書 B2: 探索を速くした書き方が、従来と同じ結果になること
// （2026-11-19 に、直す前のコードとランダムな勤務表1,600枚・種付きの生成結果を突き合わせ、完全一致を確認済み。
//   ここでは、その性質をテストとして残す）

function randomGrid(input: GenerateInput, seed: number): AssignmentGrid {
  const rnd = createSeededRandom(seed)
  const pids = ['', ...input.shiftPatterns.map((p) => p.id)]
  const grid: AssignmentGrid = {}
  for (const s of input.staff) {
    grid[s.id] = {}
    for (let d = 1; d <= input.daysInMonth; d++) {
      const pid = pids[Math.floor(rnd() * pids.length)]
      if (pid) grid[s.id][String(d)] = pid
    }
  }
  return grid
}

/** 相性（逆順の重複・職員にいない人を含む） */
function withCompatibilities(input: GenerateInput, seed: number): GenerateInput {
  const rnd = createSeededRandom(seed)
  const ids = input.staff.map((s) => s.id)
  const levels = ['double', 'caution', 'x'] as const
  const comps: CompatibilityWithId[] = []
  for (let k = 0; k < 10; k++) {
    const a = ids[Math.floor(rnd() * ids.length)]
    const b = k % 4 === 0 ? 'ghost' : ids[Math.floor(rnd() * ids.length)]
    comps.push({ id: `c${k}`, staffIdA: a, staffIdB: b, level: levels[k % 3] })
    if (k % 3 === 0) comps.push({ id: `c${k}r`, staffIdA: b, staffIdB: a, level: levels[(k + 1) % 3] })
  }
  return { ...input, compatibilities: comps }
}

/** 直す前の相性の採点（全員の組み合わせを毎日調べる書き方）。比べるための写し */
function compScoreReference(input: GenerateInput, assignments: AssignmentGrid): number {
  const { staff, shiftPatterns, compatibilities, daysInMonth } = input
  const coeffs = input.config.score.comp
  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const levelOf = (a: string, b: string) =>
    compatibilities.find((c) => (c.staffIdA === a && c.staffIdB === b) || (c.staffIdA === b && c.staffIdB === a))?.level ?? null
  let comp = 50
  let pairs = 0
  for (let d = 1; d <= daysInMonth; d++) {
    for (let i = 0; i < staff.length; i++) {
      for (let j = i + 1; j < staff.length; j++) {
        const pa = assignments[staff[i].id]?.[String(d)]
        if (!pa) continue
        const pb = assignments[staff[j].id]?.[String(d)]
        if (pa !== pb || !patternById.get(pa)?.isWork) continue
        pairs++
        const level = levelOf(staff[i].id, staff[j].id)
        if (level === 'double') comp += coeffs.double
        else if (level === 'caution') comp += coeffs.caution
        else if (level === 'x') comp += coeffs.x
      }
    }
  }
  return Math.round(Math.max(0, Math.min(100, pairs ? 50 + ((comp - 50) * 2) / Math.sqrt(pairs) : 70)))
}

describe('weekdayOf（月ごとの表）', () => {
  it('Date で求めた曜日と同じ（月の前後にはみ出す日も）', () => {
    for (const ym of ['2024-02', '2026-01', '2026-11', '2026-12', '2028-02']) {
      for (let d = -8; d <= 40; d++) {
        const [y, m] = ym.split('-').map(Number)
        expect(weekdayOf(ym, d)).toBe(new Date(y, m - 1, d).getDay())
      }
    }
  })
})

describe('makeRowReader / makeGridView', () => {
  const input = BENCH_FACILITIES[0].build()
  const grid = randomGrid(input, 3)

  it('勤務の読み取りは assignments を直接引くのと同じ（行の無い職員・月の外の日も）', () => {
    const rd = makeRowReader(grid, input.daysInMonth)
    for (const id of [...input.staff.map((s) => s.id), 'nobody']) {
      for (let d = -2; d <= input.daysInMonth + 2; d++) expect(rd(id, d)).toBe(grid[id]?.[String(d)])
    }
  })

  it('日ごとの人数は、1人ずつ数えた数と同じ（空欄も数える）', () => {
    const view = makeGridView(grid, input.daysInMonth, input.staff)
    for (let d = 1; d <= input.daysInMonth; d++) {
      for (const pid of [undefined, ...input.shiftPatterns.map((p) => p.id)]) {
        const n = input.staff.filter((s) => grid[s.id]?.[String(d)] === pid).length
        expect(view.dayCounts(d).get(pid) ?? 0).toBe(n)
      }
    }
  })
})

describe('違反チェック・採点: 共有の読み取りを渡しても渡さなくても同じ', () => {
  it.each(BENCH_FACILITIES.map((f) => [f.label, f.build] as const))('%s', (_label, build) => {
    const input = withCompatibilities(build(), 11)
    for (let seed = 1; seed <= 15; seed++) {
      const grid = randomGrid(input, seed)
      const view = makeGridView(grid, input.daysInMonth, input.staff)
      const plain = checkMonth(makeCheckInput(grid, input))
      const shared = checkMonth({ ...makeCheckInput(grid, input), gridView: view })
      expect(shared).toEqual(plain)
      for (const profile of input.config.profiles) {
        expect(scoreGrid(input, grid, profile, view)).toEqual(scoreGrid(input, grid, profile))
      }
      // 相性の採点は、直す前の書き方と同じ値
      expect(scoreGrid(input, grid, input.config.profiles[0]).comp).toBe(compScoreReference(input, grid))
    }
  })

  it('違う勤務表の読み取りを渡されたときは使わない（作り直す）', () => {
    const input = BENCH_FACILITIES[1].build()
    const a = randomGrid(input, 1)
    const b = randomGrid(input, 2)
    const viewOfA = makeGridView(a, input.daysInMonth, input.staff)
    expect(checkMonth({ ...makeCheckInput(b, input), gridView: viewOfA })).toEqual(checkMonth(makeCheckInput(b, input)))
    expect(scoreGrid(input, b, input.config.profiles[0], viewOfA)).toEqual(scoreGrid(input, b, input.config.profiles[0]))
  })
})
