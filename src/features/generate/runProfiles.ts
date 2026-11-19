/**
 * 3案を順に作る処理（generate() と同じ順・同じ中身）に、「何案目を作っているか」の知らせを足したもの。
 * Worker の中と、Worker が使えないときの画面側の両方から使う（remaining-work-design.md §21）。
 */
import { generateOne } from '../../domain/scheduler/generateOne'
import type { Candidate, GenerateInput } from '../../domain/scheduler/types'

export interface GenerateProgress {
  /** 0始まりの、いま作っている案の番号 */
  index: number
  total: number
  /** 案の名前（例: 案A） */
  label: string
}

/** 1案ずつ作る。各案の前に onProgress を呼ぶ */
export function runProfiles(input: GenerateInput, onProgress: (p: GenerateProgress) => void): Candidate[] {
  const profiles = input.config.profiles
  return profiles.map((profile, index) => {
    onProgress({ index, total: profiles.length, label: profile.label })
    return generateOne(input, profile)
  })
}

/** Worker とやりとりする内容 */
export type GenerateWorkerRequest = { input: GenerateInput }
export type GenerateWorkerMessage =
  | { type: 'progress'; progress: GenerateProgress }
  | { type: 'done'; candidates: Candidate[] }
  | { type: 'error'; message: string }

/** Worker の中身（受け取った入力で3案を作り、進み具合と結果を送る）。テストしやすいよう送り先を引数にしている */
export function handleWorkerRequest(req: GenerateWorkerRequest, post: (msg: GenerateWorkerMessage) => void) {
  try {
    const candidates = runProfiles(req.input, (progress) => post({ type: 'progress', progress }))
    post({ type: 'done', candidates })
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
