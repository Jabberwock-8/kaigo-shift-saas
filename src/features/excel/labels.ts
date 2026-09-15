/**
 * Excelテンプレートの日本語ラベル ⇔ 内部enum の対応表。P7a(出力)/P7b(取込)で共用する。
 * 旧HTML版の CONDMAP/DAYSMAP/TARGETMAP/DOWMAP_JA と同じ語彙・表記を踏襲する。
 */
import type { RuleCondType, RuleDaysType, RuleTargetType } from '../../types/models'

function invert<K extends string, V extends string>(m: Record<K, V>): Record<V, K> {
  const out = {} as Record<V, K>
  for (const k of Object.keys(m) as K[]) out[m[k]] = k
  return out
}

export const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

export const DOW_BY_LABEL: Record<string, number> = Object.fromEntries(
  DOW_LABELS.map((label, i) => [label, i]),
)

export const DAYS_TYPE_LABELS: Record<RuleDaysType, string> = {
  all: '毎日',
  weekdays: '平日',
  weekend: '土日',
  dow: '曜日指定',
  dates: '日付指定',
}
export const DAYS_TYPE_BY_LABEL = invert(DAYS_TYPE_LABELS)

export const TARGET_TYPE_LABELS: Record<RuleTargetType, string> = {
  shift: 'シフト種別',
  qualification: '資格',
  trait: '特性タグ',
  staff: '特定職員',
  traitPair: 'タグのペア',
  shiftGroup: 'シフトの組み合わせ',
  secondaryShift: '生活相談員（兼務行）',
}
export const TARGET_TYPE_BY_LABEL = invert(TARGET_TYPE_LABELS)

export const COND_TYPE_LABELS: Record<RuleCondType, string> = {
  atLeast: 'N名以上配置',
  exact: 'ちょうどN名配置',
  atMost: 'N名以下',
  none: '配置しない',
  work: '必ず勤務させる',
  off: '勤務させない',
  preferShift: '特定のシフトを優先',
  together: '同一シフトに配置する',
  notTogether: '同一シフトに入れない',
  atLeastGroup: 'グループ合計でN名以上',
  notTogetherGroup: '同時に配置しない',
}
export const COND_TYPE_BY_LABEL = invert(COND_TYPE_LABELS)

export function excelBool(v: unknown): boolean {
  return String(v ?? '').trim() === 'はい'
}

export function boolLabel(v: boolean): string {
  return v ? 'はい' : 'いいえ'
}

/** カンマ・読点区切りの文字列をトリムした配列にする */
export function splitList(v: unknown): string[] {
  return String(v ?? '')
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function normTime(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (m) return m[1].padStart(2, '0') + ':' + m[2]
  return s
}
