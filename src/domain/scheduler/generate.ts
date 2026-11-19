import { generateBest } from './generateBest'
import type { Candidate, GenerateInput } from './types'

/**
 * config.profiles ごとに、持ち時間の中で作り直していちばん良い案を作り（generateBest。B3）、3案（既定ではA/B/C）を返す。
 * UIから呼ぶ際は、呼び出し側で `await new Promise(r => setTimeout(r, 30))` のように
 * 1フレーム逃してから実行すると、旧版と同じく生成中に画面がフリーズしにくくなる。
 */
export function generate(input: GenerateInput): Candidate[] {
  return input.config.profiles.map((profile) => generateBest(input, profile))
}
