import type { Staff } from '../types/models'

/**
 * 職員の職種IDを取り出す。
 * 職種は兼務のため複数持てるが、複数化する前のデータは単数の jobTypeId に入っている。
 * 読み取り側が個別に両対応すると解釈がぶれるため、ここに集約する。
 */
export function staffJobTypeIds(staff: Pick<Staff, 'jobTypeIds' | 'jobTypeId'>): string[] {
  // 配列が存在すればそれが正。空配列は「職種なし」であって未移行ではないため、旧データへ戻さない
  // （戻すと、編集画面で全部外した瞬間に旧職種が復活してしまう）
  if (staff.jobTypeIds) return staff.jobTypeIds
  return staff.jobTypeId ? [staff.jobTypeId] : []
}

type MonthCells = Record<string, Record<string, string>> | undefined

/** その職員の行（通常行・兼務行）に、その月1日でも入力があるか */
export function hasEntriesInMonth(staffId: string, assignments: MonthCells, secondaryAssignments?: MonthCells): boolean {
  const hasAny = (row: Record<string, string> | undefined) => !!row && Object.values(row).some((v) => !!v)
  return hasAny(assignments?.[staffId]) || hasAny(secondaryAssignments?.[staffId])
}

/**
 * その月の勤務表・出力に出す職員。有効な職員に加えて、無効にした職員でもその月に入力があれば出す
 * （過去の月の勤務表・印刷・市の提出様式から、退職した人の行が消えないように。remaining-work-design.md §18）。
 * 並び順は受け取った順のまま。自動生成の対象には使わない（生成は有効な職員だけ）
 */
export function staffShownInMonth<T extends { id: string; active?: boolean }>(
  staff: T[],
  assignments: MonthCells,
  secondaryAssignments?: MonthCells,
): T[] {
  return staff.filter((s) => s.active !== false || hasEntriesInMonth(s.id, assignments, secondaryAssignments))
}

/** その職員の入力（通常行・兼務行）がある月（勤務表のID＝年月）の一覧。職員の削除前の確認用（§18 A2） */
export function monthsWithStaffEntries(
  staffId: string,
  schedules: { id: string; assignments?: MonthCells; secondaryAssignments?: MonthCells }[],
): string[] {
  return schedules
    .filter((sc) => hasEntriesInMonth(staffId, sc.assignments, sc.secondaryAssignments))
    .map((sc) => sc.id)
    .sort()
}
