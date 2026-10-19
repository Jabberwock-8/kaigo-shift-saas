/**
 * 画面の勤務表を Excel（.xlsx）で書き出す。xlsx は大きいので、ボタンを押したときだけ読み込む。
 * 見た目（色）は付けず、記号・集計を表のまま出す。
 */
import type { ShiftPattern, Staff } from '../../types/models'
import { formatYearMonthLabel, weekdayOf, WEEKDAY_LABELS } from '../../lib/dateUtils'

type StaffWithId = Staff & { id: string }
type PatternWithId = ShiftPattern & { id: string }

export interface ShiftExcelInput {
  facilityName: string
  yearMonth: string
  days: number[]
  staffList: StaffWithId[]
  shiftPatterns: PatternWithId[]
  assignments: Record<string, Record<string, string>>
  secondaryAssignments?: Record<string, Record<string, string>>
  events?: Record<string, string>
  /** 右端の個人別集計に出す勤務パターン */
  summaryPatterns: PatternWithId[]
  /** 下の日別集計に出す勤務パターン */
  workPatterns: PatternWithId[]
  /** 日別集計のセルの文字（例: "2/2"、必要数が無ければ "2"） */
  tallyText: (patternId: string, day: number) => string
  /** 個人別の常勤換算（無ければ null） */
  fteFor: (staffId: string) => number | null
}

/** 2次元配列を作る（純関数。テストしやすいよう Excel 化と分けている） */
export function buildShiftSheetRows(input: ShiftExcelInput): (string | number)[][] {
  const { yearMonth, days, staffList, shiftPatterns, assignments, secondaryAssignments, events, summaryPatterns } = input
  const codeOf = new Map(shiftPatterns.map((p) => [p.id, p.code]))
  const blankSummary = summaryPatterns.map(() => '')

  const rows: (string | number)[][] = []
  rows.push([`${input.facilityName}　${formatYearMonthLabel(yearMonth)} 勤務表`])
  rows.push(['職員', ...days, ...summaryPatterns.map((p) => p.code), '常勤換算'])
  rows.push(['', ...days.map((d) => WEEKDAY_LABELS[weekdayOf(yearMonth, d)]), ...blankSummary, ''])
  rows.push(['行事', ...days.map((d) => events?.[String(d)] ?? ''), ...blankSummary, ''])

  for (const s of staffList) {
    const byDay = assignments[s.id] ?? {}
    const counts = summaryPatterns.map((p) => days.filter((d) => byDay[String(d)] === p.id).length || '')
    const fte = input.fteFor(s.id)
    rows.push([s.name, ...days.map((d) => codeOf.get(byDay[String(d)] ?? '') ?? ''), ...counts, fte != null ? Number(fte.toFixed(1)) : ''])
    if (s.traits?.includes('生活相談員')) {
      const sec = secondaryAssignments?.[s.id] ?? {}
      rows.push(['└ 生活相談員', ...days.map((d) => codeOf.get(sec[String(d)] ?? '') ?? ''), ...blankSummary, ''])
    }
  }

  for (const p of input.workPatterns) {
    rows.push([`${p.code} 計`, ...days.map((d) => input.tallyText(p.id, d)), ...blankSummary, ''])
  }
  return rows
}

export async function downloadShiftExcel(input: ShiftExcelInput) {
  const XLSX = await import('xlsx')
  const rows = buildShiftSheetRows(input)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 16 }, ...input.days.map(() => ({ wch: 5 })), ...input.summaryPatterns.map(() => ({ wch: 5 })), { wch: 8 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, formatYearMonthLabel(input.yearMonth))
  const safe = input.facilityName.replace(/[\\/:*?"<>|]/g, '_')
  XLSX.writeFile(wb, `勤務表_${safe}_${formatYearMonthLabel(input.yearMonth)}.xlsx`)
}
