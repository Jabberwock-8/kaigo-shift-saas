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
