/**
 * 自動生成の乱数と時計（改善指示書 B0。remaining-work-design.md §20）。
 * 生成は乱数を使うため、1回の結果では良くなったか分からない。種（seed）を渡すと毎回同じ乱数の列になる乱数を
 * GenerateInput から渡せるようにして、計測（npm run bench）とテストで比べられるようにする。
 * 画面からの生成では何も渡さないので、従来どおり Math.random と Date.now を使う。
 */
import type { GenerateInput } from './types'

export type RandomFn = () => number

/** 種付きの乱数（mulberry32）。0以上1未満を返す。同じ種なら同じ列になる */
export function createSeededRandom(seed: number): RandomFn {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 生成で使う乱数。未指定なら Math.random */
export function rngOf(input: Pick<GenerateInput, 'random'>): RandomFn {
  return input.random ?? Math.random
}

/** 生成で使う時計(ms)。未指定なら Date.now（テストでは、呼ぶたびに進む時計を渡して打ち切りを決まった回数にする） */
export function nowOf(input: Pick<GenerateInput, 'now'>): () => number {
  return input.now ?? Date.now
}

/** 0 以上 n 未満の整数 */
export function randomInt(rnd: RandomFn, n: number): number {
  return Math.floor(rnd() * n)
}
