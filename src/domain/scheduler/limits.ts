import type { EmploymentType, ShiftRulesSettings, Staff } from '../../types/models'

export interface ResolvedLimits {
  /** 必要勤務日数（下限）。hasTargetWorkdays な雇用区分のみ有効。null=下限なし */
  targetWorkdays: number | null
  /** 最大勤務日数（上限）。null=上限なし */
  maxWorkdays: number | null
  /** 連続勤務日数の上限。null=上限なし */
  maxConsecutive: number | null
  /** 夜勤回数の上限（月間）。null=上限なし */
  maxNights: number | null
}

export interface MonthlyLimitsOverride {
  targetWorkdays?: number | null
  maxWorkdays?: number | null
}

/**
 * この雇用区分で「必要勤務日数（下限）」が効くか。
 * 旧版は「常勤」という文字列を直接判定して必要出勤日数(下限)チェックを適用していた（設定不要で常に有効）。
 * 新版は雇用区分ごとに hasTargetWorkdays を管理者が設定する方式に一般化したが、
 * 設定を忘れると下限チェックが効かなくなる事故が起きたため、「常勤」という表示名なら
 * フラグの設定に関わらず常に有効にする救済策を入れている（フラグでの追加指定はそのまま尊重）。
 * 職員編集画面の警告表示でも同じ判定を使うため、ここに集約する。
 */
export function employmentTypeUsesTargetWorkdays(employmentType: EmploymentType | undefined): boolean {
  return (employmentType?.hasTargetWorkdays ?? false) || employmentType?.label === '常勤'
}

/**
 * 職員の勤務日数等の上限を解決する。
 * 優先順（docs/firestore-design.md §4-1）: 月別上書き → 職員 → 施設既定 → 制約なし(null)。
 * check.ts と生成エンジン(Phase 4d)の両方から共用する。
 */
export function resolveLimits(
  staff: Staff,
  employmentType: EmploymentType | undefined,
  settings: ShiftRulesSettings,
  monthlyOverride?: MonthlyLimitsOverride,
): ResolvedLimits {
  const wc = staff.workConditions ?? {}
  const hasTargetWorkdays = employmentTypeUsesTargetWorkdays(employmentType)

  const targetWorkdays = hasTargetWorkdays
    ? (monthlyOverride?.targetWorkdays ??
      wc.targetWorkdaysPerMonth ??
      settings.monthlyLimitsDefault.targetWorkdays ??
      null)
    : null

  const maxWorkdays =
    monthlyOverride?.maxWorkdays ??
    wc.maxWorkdaysPerMonth ??
    settings.monthlyLimitsDefault.maxWorkdays ??
    null

  const maxConsecutive = wc.maxConsecutiveWorkdays ?? settings.maxConsecutiveWorkdaysDefault ?? null

  const maxNights = wc.maxNightShiftsPerMonth ?? settings.monthlyLimitsDefault.maxNightShifts ?? null

  return { targetWorkdays, maxWorkdays, maxConsecutive, maxNights }
}
