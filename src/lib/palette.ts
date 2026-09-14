/**
 * 旧HTML版から抽出したパステル配色パレット（背景色と文字色のペア）。
 * 勤務パターンの色はこのペアから選ぶことで、旧版と同じ柔らかい見た目になる。
 */
export interface ColorPair {
  bg: string
  text: string
}

export const PASTEL_PALETTE: ColorPair[] = [
  { bg: '#FAEEDA', text: '#633806' }, // 早出系（アンバー）
  { bg: '#E9EFFB', text: '#33487A' }, // 青
  { bg: '#E1F5EE', text: '#085041' }, // 緑
  { bg: '#EEEDFE', text: '#3C3489' }, // 藤
  { bg: '#E6F1FB', text: '#0C447C' }, // 夜勤系（空色）
  { bg: '#FBE6F1', text: '#7C0C44' }, // 桃
  { bg: '#FFF3D6', text: '#8A5A0A' }, // 山吹
  { bg: '#EAF7E5', text: '#2F6B1F' }, // 若葉
  { bg: '#F0EAFB', text: '#5B3A8A' }, // 紫
  { bg: '#F5E9DC', text: '#7A4A1E' }, // 土
  { bg: '#E4F2ED', text: '#0C4A3B' }, // 深緑
  { bg: '#F3E9EE', text: '#6A2A4A' }, // 小豆
  { bg: '#F5F4F0', text: '#8A8880' }, // 公休向け（灰）
  { bg: '#FBF6DE', text: '#7A6A2A' }, // 有給向け（生成り）
]

/** 新規パターン作成時の既定色（既存件数から順繰りに割り当てる） */
export function defaultPairFor(index: number): ColorPair {
  return PASTEL_PALETTE[index % PASTEL_PALETTE.length]
}
