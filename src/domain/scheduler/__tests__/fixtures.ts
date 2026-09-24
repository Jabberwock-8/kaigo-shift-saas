import { GENERATION_DEFAULTS_V1, type GenerationConfig } from '../defaults'
import type { ShiftRulesSettings } from '../../../types/models'
import type {
  EmploymentTypeWithId,
  GenerateInput,
  PatternWithId,
  RuleWithId,
  StaffWithId,
} from '../types'

/** 2026年9月（1日が火曜。土日は 5,6 / 12,13 / 19,20 / 26,27） */
export const YM = '2026-09'
export const DAYS = 30
export const WEEKENDS = [5, 6, 12, 13, 19, 20, 26, 27]

export const OFF: PatternWithId = { id: 'off', code: '公休', label: '公休', category: 'off', isWork: false, isNight: false }
export const A: PatternWithId = { id: 'A', code: 'A', label: 'A勤', startTime: '07:00', endTime: '16:00', category: 'day', isWork: true, isNight: false }
export const B: PatternWithId = { id: 'B', code: 'B', label: 'B勤', startTime: '08:30', endTime: '17:30', category: 'day', isWork: true, isNight: false }
export const M: PatternWithId = { id: 'M', code: 'M', label: 'M勤', startTime: '13:00', endTime: '22:00', category: 'day', isWork: true, isNight: false }

export const FULL: EmploymentTypeWithId = { id: 'full', label: '常勤', hasTargetWorkdays: true }
export const PART: EmploymentTypeWithId = { id: 'part', label: '非常勤', hasTargetWorkdays: false }

export function settings(patch: Partial<ShiftRulesSettings> = {}): ShiftRulesSettings {
  return {
    nightMode: null,
    nightAvoidPatternIdsAfter2: [],
    shiftConsecutiveCaps: {},
    minRestHours: null,
    preferredFillTimeRange: { start: null, end: null },
    treatCompatibilityXAsHard: null,
    treatRestHoursAsHard: null,
    maxConsecutiveWorkdaysDefault: null,
    monthlyLimitsDefault: { targetWorkdays: null, maxWorkdays: null, maxNightShifts: null },
    maxWishesPerMonth: null,
    ...patch,
  }
}

export function staff(id: string, patch: Partial<StaffWithId> = {}): StaffWithId {
  return { id, name: id, active: true, employmentTypeId: 'full', ...patch }
}

let ruleSeq = 0
export function rule(patch: Omit<RuleWithId, 'id' | 'enabled'> & { enabled?: boolean }): RuleWithId {
  ruleSeq += 1
  return { id: `r${ruleSeq}`, enabled: true, ...patch }
}

export function input(patch: Partial<GenerateInput> = {}, configPatch: Partial<GenerationConfig['engine']> = {}): GenerateInput {
  return {
    yearMonth: YM,
    daysInMonth: DAYS,
    staff: [],
    employmentTypes: [FULL, PART],
    shiftPatterns: [OFF, A, B, M],
    rules: [],
    compatibilities: [],
    settings: settings(),
    wishes: [],
    lockedCells: {},
    baseAssignments: {},
    config: {
      ...GENERATION_DEFAULTS_V1,
      // テストの所要時間と再現性のため、時間で打ち切る探索は短くする
      engine: { ...GENERATION_DEFAULTS_V1.engine, hillClimbMs: 50, repairMaxMs: 300, groupRepairMaxMs: 300, ...configPatch },
    },
    ...patch,
  }
}
