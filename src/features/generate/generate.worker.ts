/**
 * 自動生成を画面とは別の所（Web Worker）で動かす。生成中も画面が固まらないようにする（remaining-work-design.md §21）。
 * 中身は runProfiles.ts の handleWorkerRequest。ここは受け取りと送り返しだけ。
 */
import { handleWorkerRequest, type GenerateWorkerMessage, type GenerateWorkerRequest } from './runProfiles'

// tsconfig の lib が DOM のため、Worker の self の型をここで決める
const ctx = self as unknown as {
  postMessage: (msg: GenerateWorkerMessage) => void
  onmessage: ((e: MessageEvent<GenerateWorkerRequest>) => void) | null
}

ctx.onmessage = (e) => {
  handleWorkerRequest(e.data, (msg) => ctx.postMessage(msg))
}
