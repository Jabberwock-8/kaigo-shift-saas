/**
 * Firestore コレクションの型定義。
 * 詳細・フィールドの意味は docs/firestore-design.md を参照。
 * Phase 1 で使うものだけを先に定義し、以降のフェーズで拡張する。
 */

export type Role = 'admin' | 'staff'

export interface AppUser {
  email: string
  displayName?: string
  organizationId: string
  facilityIds: string[]
  primaryFacilityId: string | null
  role: Role
  linkedStaffId: string | null
}

export interface Organization {
  name: string
}

export interface Facility {
  organizationId: string
  name: string
  shortName?: string
}

export interface StaffWorkConditions {
  workablePatternIds?: string[]
  ngPatternIds?: string[]
  nightShiftAllowed?: boolean | null
  nightShiftTarget?: number | null
  maxNightShiftsPerMonth?: number | null
  targetWorkdaysPerMonth?: number | null
  maxWorkdaysPerMonth?: number | null
  maxConsecutiveWorkdays?: number | null
  fixedOffWeekdays?: number[]
  notes?: string
}

export interface Staff {
  name: string
  nameKana?: string
  jobTypeId?: string
  employmentTypeId?: string
  active: boolean
  order?: number
  qualifications?: string[]
  traits?: string[]
  workConditions?: StaffWorkConditions
}

export interface JobType {
  label: string
  shortLabel?: string
  order?: number
  color?: string
}

export interface EmploymentType {
  label: string
  order?: number
  /** true の区分は「必要勤務日数(下限)」チェックの対象になる（例: 常勤） */
  hasTargetWorkdays?: boolean
}

export type ShiftCategory =
  | 'day'
  | 'early'
  | 'late'
  | 'night'
  | 'afterNight'
  | 'off'
  | 'paidLeave'
  | 'individual'

export interface ShiftPattern {
  code: string
  label: string
  startTime?: string
  endTime?: string
  category?: ShiftCategory
  isWork: boolean
  isNight: boolean
  isSystem?: boolean
  order?: number
  color?: string
}
