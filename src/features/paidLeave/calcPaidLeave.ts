import { parseYearMonth, shiftYearMonth } from '../../lib/dateUtils'
import type { PaidLeaveInfo } from '../../types/models'

/** "YYYY-MM" 形式の年月一覧を from〜to（両端含む）で昇順に列挙する */
export function yearMonthRange(from: string, to: string): string[] {
  const months: string[] = []
  let cur = from
  // from > to のときは空配列（安全のため上限を設ける）
  for (let i = 0; i < 600 && cur <= to; i++) {
    months.push(cur)
    cur = shiftYearMonth(cur, 1)
  }
  return months
}

/**
 * 有給休暇の残日数を計算する（純ロジック）。
 * baselineYearMonth時点の残日数を起点に、baselineの翌月からtargetYearMonthまでの各月について
 * 「grantMonthに一致すればgrantDaysを加算」「その月の有給消化日数を減算」を積み上げる。
 * usedDaysByYearMonth はカレンダー上に存在する年月だけ渡せばよい（無い月は0扱い）。
 */
export function calcPaidLeaveBalance(
  info: PaidLeaveInfo | undefined,
  targetYearMonth: string,
  usedDaysByYearMonth: Record<string, number>,
): number | null {
  if (!info?.baselineYearMonth || info.baselineDays == null) return null
  if (targetYearMonth < info.baselineYearMonth) return null

  let balance = info.baselineDays
  let cur = shiftYearMonth(info.baselineYearMonth, 1)
  while (cur <= targetYearMonth) {
    const { month0 } = parseYearMonth(cur)
    if (info.grantMonth != null && month0 + 1 === info.grantMonth) {
      balance += info.grantDays ?? 0
    }
    balance -= usedDaysByYearMonth[cur] ?? 0
    cur = shiftYearMonth(cur, 1)
  }
  return balance
}
