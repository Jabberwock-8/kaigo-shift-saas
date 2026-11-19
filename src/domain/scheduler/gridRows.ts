/**
 * 違反チェック・採点の1回の間だけ使う、勤務の読み取り（改善指示書 B2）。
 * 探索では1手ごとに「この人のこの日の勤務」を何万回も引くため、日付を毎回文字に直して2段で探すのをやめ、
 * 最初に引いたときに職員ごとの「日 → 勤務ID」の並びを作って、以後は番号で引く。結果は assignments を直接引くのと同じ。
 * 勤務表を書き換える処理（探索・修復）の途中では使わない（並びが古くなるため）。1回の計算の中だけで使う。
 */
import type { AssignmentGrid } from './types'

export interface RowReader {
  (staffId: string, day: number): string | undefined
  /** その職員の「日 → 勤務ID」の並び（添字1〜月の日数。勤務表に行が無ければ全部 undefined） */
  row: (staffId: string) => (string | undefined)[]
}

/** 日の文字（'1'〜'31' ほか）。String(d) を毎回作らないため */
const DAY_KEYS: string[] = Array.from({ length: 40 }, (_, i) => String(i))

export function makeRowReader(assignments: AssignmentGrid, daysInMonth: number): RowReader {
  const rows = new Map<string, (string | undefined)[]>()
  const row = (staffId: string) => {
    let r = rows.get(staffId)
    if (!r) {
      const src = assignments[staffId]
      r = new Array<string | undefined>(daysInMonth + 1)
      if (src) for (let d = 1; d <= daysInMonth; d++) r[d] = src[DAY_KEYS[d]]
      rows.set(staffId, r)
    }
    return r
  }
  const read = ((staffId: string, day: number) => {
    // 月の外の日（前月末・翌月）は従来どおり直接引く
    if (day < 1 || day > daysInMonth || !Number.isInteger(day)) return assignments[staffId]?.[String(day)]
    return row(staffId)[day]
  }) as RowReader
  read.row = row
  return read
}

/**
 * 1回の評価で、違反チェックと採点が共有する読み取り（探索の1手ごとに作る）。
 * - read: 勤務の読み取り
 * - dayCounts: staff のうち、その日に各勤務に入っている人数（空欄 undefined も数える。従来の「=== で1人ずつ数える」と同じ数）
 * 作ったときの assignments・staff と同じものに対してだけ使う（違えば呼び出し側で作り直す）
 */
export interface GridView {
  assignments: AssignmentGrid
  staff: readonly { id: string }[]
  read: RowReader
  dayCounts: (day: number) => Map<string | undefined, number>
}

export function makeGridView(assignments: AssignmentGrid, daysInMonth: number, staff: readonly { id: string }[]): GridView {
  const read = makeRowReader(assignments, daysInMonth)
  const byDay = new Map<number, Map<string | undefined, number>>()
  const dayCounts = (day: number) => {
    let m = byDay.get(day)
    if (!m) {
      m = new Map()
      for (const s of staff) {
        const pid = read(s.id, day)
        m.set(pid, (m.get(pid) ?? 0) + 1)
      }
      byDay.set(day, m)
    }
    return m
  }
  return { assignments, staff, read, dayCounts }
}

/** 渡された共有の読み取りが、この勤務表・職員のものなら使い、違えば作る */
export function gridViewFor(
  view: GridView | undefined,
  assignments: AssignmentGrid,
  daysInMonth: number,
  staff: readonly { id: string }[],
): GridView {
  return view && view.assignments === assignments && view.staff === staff ? view : makeGridView(assignments, daysInMonth, staff)
}
