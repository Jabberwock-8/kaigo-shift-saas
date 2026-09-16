export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function currentYearMonth(): string {
  const t = new Date()
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`
}

export function parseYearMonth(yearMonth: string): { year: number; month0: number } {
  const [y, m] = yearMonth.split('-').map(Number)
  return { year: y, month0: m - 1 }
}

export function daysInMonth(yearMonth: string): number {
  const { year, month0 } = parseYearMonth(yearMonth)
  return new Date(year, month0 + 1, 0).getDate()
}

export function weekdayOf(yearMonth: string, day: number): number {
  const { year, month0 } = parseYearMonth(yearMonth)
  return new Date(year, month0, day).getDay()
}

export function shiftYearMonth(yearMonth: string, delta: number): string {
  const { year, month0 } = parseYearMonth(yearMonth)
  const d = new Date(year, month0 + delta, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

export function formatYearMonthLabel(yearMonth: string): string {
  const { year, month0 } = parseYearMonth(yearMonth)
  return `${year}年${month0 + 1}月`
}

/** "YYYY-MM" と日 -> "YYYY-MM-DD" */
export function formatDate(yearMonth: string, day: number): string {
  const { year, month0 } = parseYearMonth(yearMonth)
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`
}

/** "YYYY-MM" と日 -> "9/8(火)" */
export function formatMonthDayWeekday(yearMonth: string, day: number): string {
  const { month0 } = parseYearMonth(yearMonth)
  const w = weekdayOf(yearMonth, day)
  return `${month0 + 1}/${day}(${WEEKDAY_LABELS[w]})`
}

/** "HH:MM" -> 小数時間（例 "09:30" -> 9.5）。不正な値は null */
export function parseTimeToHours(hhmm: string | undefined | null): number | null {
  if (!hhmm) return null
  const parts = hhmm.split(':')
  if (parts.length < 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h + m / 60
}

/**
 * 開始〜終了の実労働時間（時間）。日をまたぐ場合も対応。時刻未設定なら既定の8時間とする。
 * breakHours（中抜け・休憩）を渡すと、開始〜終了の時間からその分を差し引く
 * （例: 7:00〜20:00・休憩5時間の中抜け勤務 → 実働8時間）。
 */
export function shiftDurationHours(
  startTime: string | undefined,
  endTime: string | undefined,
  breakHours = 0,
): number {
  const start = parseTimeToHours(startTime)
  const end = parseTimeToHours(endTime)
  if (start == null || end == null) return 8
  let diff = end - start
  if (diff <= 0) diff += 24
  return Math.max(0, diff - breakHours)
}
