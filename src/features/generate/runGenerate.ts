/**
 * 画面から自動生成を呼ぶ入口（remaining-work-design.md §21）。
 * Web Worker で動かして画面を固めず、進み具合を知らせ、中止できるようにする。
 * Worker が作れない・読み込めない環境では、従来どおり画面と同じ所で動かす（結果は同じ）。
 */
import type { Candidate, GenerateInput } from '../../domain/scheduler/types'
import { runProfiles, type GenerateProgress, type GenerateWorkerMessage } from './runProfiles'

export type { GenerateProgress }

/** 中止したとき（何も保存しない） */
export class GenerationCancelledError extends Error {
  constructor() {
    super('生成を中止しました')
    this.name = 'GenerationCancelledError'
  }
}

interface Options {
  onProgress?: (p: GenerateProgress) => void
  signal?: AbortSignal
}

/** Worker には関数を送れないため外す（画面からは渡していない。計測・テスト用の項目） */
function plainInput(input: GenerateInput): GenerateInput {
  const { random: _random, now: _now, ...rest } = input
  return rest
}

/** Worker を使わずに作る。各案の間で一息ついて画面の表示を更新し、中止もそこで効かせる */
export async function runGenerateInPage(input: GenerateInput, { onProgress, signal }: Options = {}): Promise<Candidate[]> {
  const out: Candidate[] = []
  const profiles = input.config.profiles
  for (let i = 0; i < profiles.length; i++) {
    await new Promise((r) => setTimeout(r, 30))
    if (signal?.aborted) throw new GenerationCancelledError()
    // 1案だけ作る（runProfiles と同じ処理を1案分）
    const [c] = runProfiles({ ...input, config: { ...input.config, profiles: [profiles[i]] } }, (p) =>
      onProgress?.({ ...p, index: i, total: profiles.length }),
    )
    out.push(c)
  }
  if (signal?.aborted) throw new GenerationCancelledError()
  return out
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  try {
    return new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
}

export function runGenerate(input: GenerateInput, options: Options = {}): Promise<Candidate[]> {
  const { onProgress, signal } = options
  if (signal?.aborted) return Promise.reject(new GenerationCancelledError())
  const worker = createWorker()
  if (!worker) return runGenerateInPage(input, options)

  return new Promise<Candidate[]>((resolve, reject) => {
    let settled = false
    const finish = () => {
      settled = true
      worker.terminate()
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (settled) return
      finish()
      reject(new GenerationCancelledError())
    }
    signal?.addEventListener('abort', onAbort)

    worker.onmessage = (e: MessageEvent<GenerateWorkerMessage>) => {
      if (settled) return
      const msg = e.data
      if (msg.type === 'progress') onProgress?.(msg.progress)
      else if (msg.type === 'done') {
        finish()
        resolve(msg.candidates)
      } else {
        finish()
        reject(new Error(msg.message))
      }
    }
    // Worker 自体が読み込めなかったとき（生成の中のエラーは 'error' メッセージで届く）。画面側で作り直す
    worker.onerror = (e) => {
      if (settled) return
      e.preventDefault()
      finish()
      runGenerateInPage(input, options).then(resolve, reject)
    }
    worker.postMessage({ input: plainInput(input) })
  })
}
