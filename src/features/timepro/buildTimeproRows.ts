import { weekdayOf } from '../../lib/dateUtils'
import type { ShiftPattern, TimeproPatternMapEntry } from '../../types/models'

type ShiftPatternWithId = ShiftPattern & { id: string }

/**
 * 勤務パターン1件分の TimePro-VG 表記の既定値。旧版踏襲:
 * off→勤怠区分「公休」、paidLeave→「有給」、勤務あり→シフト区分「記号:開始-終了」（時刻なしは記号のみ）、
 * それ以外（明・個別入力等）→勤怠区分に記号をそのまま。
 */
export function defaultTimeproEntry(pattern: ShiftPattern): TimeproPatternMapEntry {
  if (pattern.category === 'off') return { kotai: '公休' }
  if (pattern.category === 'paidLeave') return { kotai: '有給' }
  if (pattern.isWork) {
    const time = pattern.startTime && pattern.endTime ? `${pattern.startTime}-${pattern.endTime}` : ''
    return { shift: time ? `${pattern.code}:${time}` : pattern.code }
  }
  return { kotai: pattern.code }
}

/** 保存済みの対応表に、未設定の勤務パターン分だけ既定値を補って返す */
export function withDefaults(
  shiftPatterns: ShiftPatternWithId[],
  saved: Record<string, TimeproPatternMapEntry>,
): Record<string, TimeproPatternMapEntry> {
  const map: Record<string, TimeproPatternMapEntry> = {}
  for (const p of shiftPatterns) {
    map[p.id] = saved[p.id] ?? defaultTimeproEntry(p)
  }
  return map
}

export interface TimeproRow {
  day: number
  weekday: number
  kotai: string
  shift: string
}

/** 職員1名・1ヶ月分の勤怠区分／シフト区分を日別に組み立てる */
export function buildTimeproRows(
  yearMonth: string,
  daysInMonth: number,
  staffId: string,
  assignments: Record<string, Record<string, string>> | undefined,
  patternMap: Record<string, TimeproPatternMapEntry>,
): TimeproRow[] {
  const byDay = assignments?.[staffId] ?? {}
  const rows: TimeproRow[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const patternId = byDay[String(day)]
    const entry = patternId ? patternMap[patternId] : undefined
    rows.push({
      day,
      weekday: weekdayOf(yearMonth, day),
      kotai: entry?.kotai ?? '',
      shift: entry?.shift ?? '',
    })
  }
  return rows
}

/** クリップボードへコピーする1列分のテキスト（改行区切り） */
export function toClipboardColumn(rows: TimeproRow[], field: 'kotai' | 'shift'): string {
  return rows.map((r) => r[field]).join('\n')
}
