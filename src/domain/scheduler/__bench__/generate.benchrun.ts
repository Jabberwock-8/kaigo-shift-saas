/**
 * 自動生成の計測（npm run bench。改善指示書 B0・remaining-work-design.md §20）。
 * 架空の4施設（__tests__/fixtures/facilities.ts）で、種を変えて generate() を回し、
 * 「おすすめ」になる案（必須違反が少ない → 総合点が高い）の数字を、施設ごとに平均と最悪値で表にする。
 *
 * 時間で打ち切る処理は実際の時計で動かす（画面と同じ）。そのため数字は PC の速さで少し変わる。比べるときは同じ PC で。
 * 環境変数: BENCH_SEEDS（種の数。既定10）、BENCH_ONLY（施設のキーで絞る。例: akeWorkGender）
 * 結果は画面に出し、bench-results/ に Markdown でも保存する（Git には入れない）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { generate } from '../generate'
import { createSeededRandom } from '../random'
import type { Candidate, GenerateStats } from '../types'
import { BENCH_FACILITIES } from '../__tests__/fixtures/facilities'

const SEEDS = Number(process.env.BENCH_SEEDS ?? 10)
const ONLY = process.env.BENCH_ONLY

function recommended(cs: Candidate[]): Candidate {
  return cs.reduce((best, c) =>
    c.hardCount < best.hardCount || (c.hardCount === best.hardCount && c.scores.total > best.scores.total) ? c : best,
  )
}

interface Row {
  label: string
  hardAvg: number
  hardMax: number
  softAvg: number
  softMax: number
  totalAvg: number
  totalMin: number
  fillAvg: number
  fillMin: number
  secAvg: number
  /** 探索1回（1案）あたりの試した手の数 */
  movesAvg: number
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const f1 = (n: number) => n.toFixed(1)

it('bench: 架空4施設 × 種', () => {
  const rows: Row[] = []
  for (const fac of BENCH_FACILITIES) {
    if (ONLY && fac.key !== ONLY) continue
    const picks: Candidate[] = []
    const secs: number[] = []
    const stats: GenerateStats = { hillClimbEvaluations: 0, hillClimbRuns: 0 }
    for (let seed = 1; seed <= SEEDS; seed++) {
      const input = { ...fac.build(), random: createSeededRandom(seed), stats }
      const t0 = performance.now()
      picks.push(recommended(generate(input)))
      secs.push((performance.now() - t0) / 1000)
    }
    rows.push({
      label: fac.label,
      hardAvg: avg(picks.map((c) => c.hardCount)),
      hardMax: Math.max(...picks.map((c) => c.hardCount)),
      softAvg: avg(picks.map((c) => c.softCount)),
      softMax: Math.max(...picks.map((c) => c.softCount)),
      totalAvg: avg(picks.map((c) => c.scores.total)),
      totalMin: Math.min(...picks.map((c) => c.scores.total)),
      fillAvg: avg(picks.map((c) => c.fulfillmentRate)),
      fillMin: Math.min(...picks.map((c) => c.fulfillmentRate)),
      secAvg: avg(secs),
      movesAvg: stats.hillClimbRuns ? stats.hillClimbEvaluations / stats.hillClimbRuns : 0,
    })
  }

  const header =
    '| 施設の形 | 必須違反 平均 | 必須違反 最悪 | 推奨未達 平均 | 推奨未達 最悪 | 総合点 平均 | 総合点 最低 | 充足率% 平均 | 充足率% 最低 | 1回の秒数 平均 | 探索の手数（1案） |'
  const sep = '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  const lines = rows.map(
    (r) =>
      `| ${r.label} | ${f1(r.hardAvg)} | ${r.hardMax} | ${f1(r.softAvg)} | ${r.softMax} | ${f1(r.totalAvg)} | ${f1(r.totalMin)} | ${f1(r.fillAvg)} | ${f1(r.fillMin)} | ${f1(r.secAvg)} | ${Math.round(r.movesAvg)} |`,
  )
  const md = [`種 ${SEEDS} 個（1〜${SEEDS}）。各回の「おすすめ」案の数字。`, '', header, sep, ...lines, ''].join('\n')
  // vitest は成功したテストの console.log を出さないことがあるため、直接書き出す
  process.stdout.write('\n' + md + '\n')
  mkdirSync('bench-results', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  writeFileSync(`bench-results/bench-${stamp}.md`, md, 'utf8')
})
