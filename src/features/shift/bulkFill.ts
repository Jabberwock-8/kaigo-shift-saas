/**
 * まとめて入力（C1）で、どのマスに入れるかを決める純関数。remaining-work-design.md §19。
 * 空いているマスだけに入れる。入力済み・ロック済み・希望のある日・その職員が選べない勤務は飛ばす。
 */
import { formatDate, weekdayOf } from '../../lib/dateUtils'

export type BulkWeekdayMode = 'weekdays' | 'weekend' | 'custom'

export interface BulkFillRequest {
  yearMonth: string
  daysInMonth: number
  staffIds: string[]
  patternId: string
  mode: BulkWeekdayMode
  /** mode='custom' のときの曜日（0=日〜6=土） */
  customWeekdays: number[]
  fromDay: number
  toDay: number
}

export interface BulkFillContext {
  assignments: Record<string, Record<string, string>> | undefined
  locks: Record<string, Record<string, boolean>> | undefined
  /** その月の希望（希望休・有給希望・勤務希望）。却下されたものは数えない */
  wishes: { staffId: string; date: string; status?: string }[]
  /** その職員がこの勤務パターンを選べるか（シフト表のセル選択と同じ判定） */
  canUsePattern: (staffId: string) => boolean
}

export interface BulkFillPlan {
  cells: { staffId: string; day: number }[]
  /** 実際に入れる職員の人数 */
  staffCount: number
  skipped: { filled: number; locked: number; wish: number; notAllowed: number }
}

/** 曜日の条件に合う日（期間内） */
export function bulkFillDays(req: Pick<BulkFillRequest, 'yearMonth' | 'daysInMonth' | 'mode' | 'customWeekdays' | 'fromDay' | 'toDay'>): number[] {
  const from = Math.max(1, Math.floor(req.fromDay))
  const to = Math.min(req.daysInMonth, Math.floor(req.toDay))
  const days: number[] = []
  for (let d = from; d <= to; d++) {
    const w = weekdayOf(req.yearMonth, d)
    const ok =
      req.mode === 'weekdays' ? w >= 1 && w <= 5 : req.mode === 'weekend' ? w === 0 || w === 6 : req.customWeekdays.includes(w)
    if (ok) days.push(d)
  }
  return days
}

export function planBulkFill(req: BulkFillRequest, ctx: BulkFillContext): BulkFillPlan {
  const days = bulkFillDays(req)
  const wishKeys = new Set(ctx.wishes.filter((w) => w.status !== 'rejected').map((w) => `${w.staffId}_${w.date}`))
  const cells: { staffId: string; day: number }[] = []
  const skipped = { filled: 0, locked: 0, wish: 0, notAllowed: 0 }
  const staffWithCells = new Set<string>()
  for (const staffId of req.staffIds) {
    const allowed = ctx.canUsePattern(staffId)
    for (const d of days) {
      const key = String(d)
      if (ctx.assignments?.[staffId]?.[key]) skipped.filled++
      else if (ctx.locks?.[staffId]?.[key]) skipped.locked++
      else if (wishKeys.has(`${staffId}_${formatDate(req.yearMonth, d)}`)) skipped.wish++
      else if (!allowed) skipped.notAllowed++
      else {
        cells.push({ staffId, day: d })
        staffWithCells.add(staffId)
      }
    }
  }
  return { cells, staffCount: staffWithCells.size, skipped }
}
