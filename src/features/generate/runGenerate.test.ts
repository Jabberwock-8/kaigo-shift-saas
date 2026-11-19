import { describe, expect, it } from 'vitest'
import { generate } from '../../domain/scheduler/generate'
import { createSeededRandom } from '../../domain/scheduler/random'
import type { GenerateInput } from '../../domain/scheduler/types'
import { BENCH_FACILITIES, steppingClock } from '../../domain/scheduler/__tests__/fixtures/facilities'
import { handleWorkerRequest, runProfiles, type GenerateWorkerMessage } from './runProfiles'
import { GenerationCancelledError, runGenerate, runGenerateInPage } from './runGenerate'

// §21 B1: Worker 化しても、作る案は generate() と同じであること
function seeded(seed = 1): GenerateInput {
  const base = BENCH_FACILITIES[1].build()
  return {
    ...base,
    random: createSeededRandom(seed),
    now: steppingClock(),
    // 作り直し（B3）は generateBest.test.ts で確かめる。ここでは1案1回にして、進み具合の回数を決まった数にする
    config: { ...base.config, engine: { ...base.config.engine, hillClimbMs: 40, candidateTimeBudgetMs: 0 } },
  }
}

describe('runProfiles / handleWorkerRequest', () => {
  it('generate() と同じ3案を同じ順で作り、各案の前に進み具合を知らせる', () => {
    const progress: string[] = []
    const out = runProfiles(seeded(), (p) => progress.push(`${p.index + 1}/${p.total} ${p.label}`))
    expect(out).toEqual(generate(seeded()))
    expect(progress).toEqual(['1/3 案A 公平性重視', '2/3 案B 相性重視', '3/3 案C 希望休優先'])
  })

  it('Worker の中身: 進み具合3回のあと結果を送る', () => {
    const msgs: GenerateWorkerMessage[] = []
    handleWorkerRequest({ input: seeded() }, (m) => msgs.push(m))
    expect(msgs.map((m) => m.type)).toEqual(['progress', 'progress', 'progress', 'done'])
    const done = msgs[3] as Extract<GenerateWorkerMessage, { type: 'done' }>
    expect(done.candidates).toEqual(generate(seeded()))
  })

  it('Worker の中身: 生成できない入力は、エラーの文章を送る（画面にそのまま出す）', () => {
    const msgs: GenerateWorkerMessage[] = []
    const bad = { ...seeded(), shiftPatterns: seeded().shiftPatterns.filter((p) => p.category !== 'off') }
    handleWorkerRequest({ input: bad }, (m) => msgs.push(m))
    const last = msgs[msgs.length - 1]
    expect(last.type).toBe('error')
    expect((last as Extract<GenerateWorkerMessage, { type: 'error' }>).message.length).toBeGreaterThan(0)
  })
})

describe('runGenerate（Worker が無い環境では画面側で作る）', () => {
  it('Worker が無ければ画面側で作り、結果は generate() と同じ', async () => {
    expect(typeof Worker).toBe('undefined') // テスト環境（Node）には Worker が無い
    const progress: number[] = []
    const out = await runGenerate(seeded(), { onProgress: (p) => progress.push(p.index) })
    expect(out).toEqual(generate(seeded()))
    expect(progress).toEqual([0, 1, 2])
  })

  it('始める前に中止されていたら、作らずに中止を返す', async () => {
    const ac = new AbortController()
    ac.abort('user')
    await expect(runGenerate(seeded(), { signal: ac.signal })).rejects.toBeInstanceOf(GenerationCancelledError)
  })

  it('途中で中止すると、残りの案を作らずに中止を返す', async () => {
    const ac = new AbortController()
    const seen: number[] = []
    const p = runGenerateInPage(seeded(), {
      signal: ac.signal,
      onProgress: (pr) => {
        seen.push(pr.index)
        if (pr.index === 0) ac.abort('user')
      },
    })
    await expect(p).rejects.toBeInstanceOf(GenerationCancelledError)
    expect(seen).toEqual([0])
  })
})
