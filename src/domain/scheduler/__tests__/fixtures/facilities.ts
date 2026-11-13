/**
 * 計測（npm run bench）と再現性テスト用の、4施設の「形」をまねた架空のデータ（改善指示書 B0）。
 * 実在の職員名・実際の勤務・実際の人数は入れていない。人数・必要数・勤務時間は、形が似るように決めた仮の値。
 *
 * - directNight:     夜勤 → 公休に直行（nightMode=direct）
 * - akeWorkPreNight: 夜勤 → 明出（勤務日）→ 公休、夜勤の前日は決まった勤務（M3）
 * - akeWorkGender:   夜勤 → 明出 → 公休、男女別の勤務（日勤・夜勤とも男女で別の記号と必要数）
 * - akeRestLowFill:  準夜勤 → 明休（翌日は自由・夜勤の連続可）、B1 は「生成では後回し」、パートあり
 */
import { GENERATION_DEFAULTS_V1, type GenerationConfig } from '../../defaults'
import { createSeededRandom } from '../../random'
import type { ShiftRulesSettings } from '../../../../types/models'
import type { EmploymentTypeWithId, GenerateInput, PatternWithId, RuleWithId, StaffWithId } from '../../types'

export const BENCH_YM = '2026-11'
export const BENCH_DAYS = 30

const FULL: EmploymentTypeWithId = { id: 'full', label: '常勤', hasTargetWorkdays: true }
const PART: EmploymentTypeWithId = { id: 'part', label: '非常勤', hasTargetWorkdays: false }

const OFF: PatternWithId = { id: 'OFF', code: '公', label: '公休', category: 'off', isWork: false, isNight: false, isSystem: true }
const PAID: PatternWithId = { id: 'PAID', code: '有', label: '有給', category: 'paidLeave', isWork: false, isNight: false }

const day = (id: string, start: string, end: string, extra: Partial<PatternWithId> = {}): PatternWithId => ({
  id,
  code: id,
  label: id,
  startTime: start,
  endTime: end,
  breakHours: 1,
  category: 'day',
  isWork: true,
  isNight: false,
  ...extra,
})
const night = (id: string, start: string, end: string): PatternWithId => ({
  id,
  code: id,
  label: id,
  startTime: start,
  endTime: end,
  breakHours: 2,
  category: 'night',
  isWork: true,
  isNight: true,
})

function baseSettings(patch: Partial<ShiftRulesSettings>): ShiftRulesSettings {
  return {
    nightMode: null,
    nightAvoidPatternIdsAfter2: [],
    shiftConsecutiveCaps: {},
    minRestHours: 11,
    preferredFillTimeRange: { start: null, end: null },
    treatCompatibilityXAsHard: null,
    treatRestHoursAsHard: null,
    maxConsecutiveWorkdaysDefault: 5,
    monthlyLimitsDefault: { targetWorkdays: null, maxWorkdays: null, maxNightShifts: 6, offDaysPerMonth: 9 },
    maxWishesPerMonth: null,
    ...patch,
  }
}

let ruleSeq = 0
function need(
  patternId: string,
  type: 'exact' | 'atLeast',
  count: number,
  days: RuleWithId['days'] = { type: 'all' },
  kind: RuleWithId['kind'] = 'hard',
): RuleWithId {
  ruleSeq += 1
  return { id: `bench-r${ruleSeq}`, enabled: true, kind, days, target: { type: 'shift', value: patternId }, cond: { type, count } }
}
const WEEKDAYS: RuleWithId['days'] = { type: 'weekdays' }
const WEEKEND: RuleWithId['days'] = { type: 'weekend' }

function makeStaff(prefix: string, count: number, patch: (i: number) => Partial<StaffWithId>): StaffWithId[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i + 1).padStart(2, '0')}`,
    name: `${prefix}${i + 1}`,
    active: true,
    order: i + 1,
    employmentTypeId: 'full',
    ...patch(i),
  }))
}

/** 希望休（種で決まる架空の日。1人あたり0〜3日） */
function makeWishes(staff: StaffWithId[], seed: number): { staffId: string; day: number }[] {
  const rnd = createSeededRandom(seed)
  const out: { staffId: string; day: number }[] = []
  for (const s of staff) {
    const n = Math.floor(rnd() * 4)
    for (let k = 0; k < n; k++) {
      const d = 1 + Math.floor(rnd() * BENCH_DAYS)
      if (!out.some((w) => w.staffId === s.id && w.day === d)) out.push({ staffId: s.id, day: d })
    }
  }
  return out
}

function baseInput(patch: Partial<GenerateInput>): GenerateInput {
  return {
    yearMonth: BENCH_YM,
    daysInMonth: BENCH_DAYS,
    staff: [],
    employmentTypes: [FULL, PART],
    shiftPatterns: [],
    rules: [],
    compatibilities: [],
    settings: baseSettings({}),
    wishes: [],
    lockedCells: {},
    baseAssignments: {},
    config: GENERATION_DEFAULTS_V1,
    ...patch,
  }
}

export function directNight(): GenerateInput {
  const E = day('E', '07:00', '16:00')
  const B = day('B', '09:00', '18:00')
  const L = day('L', '11:00', '20:00')
  const N = night('N', '16:00', '09:00')
  const staff = makeStaff('D', 13, (i) => ({
    workConditions: i < 10 ? { workablePatternIds: ['E', 'B', 'L', 'N'] } : { workablePatternIds: ['E', 'B', 'L'] },
  }))
  return baseInput({
    staff,
    shiftPatterns: [OFF, PAID, E, B, L, N],
    rules: [
      need('N', 'exact', 2),
      need('E', 'atLeast', 2),
      need('B', 'atLeast', 2),
      need('L', 'atLeast', 2),
      need('B', 'atLeast', 3, WEEKDAYS, 'soft'),
    ],
    settings: baseSettings({ nightMode: 'direct' }),
    wishes: makeWishes(staff, 101),
  })
}

export function akeWorkPreNight(): GenerateInput {
  const B = day('B', '09:00', '18:00')
  const M3 = day('M3', '10:00', '19:00')
  const N = night('N', '16:00', '10:00')
  const AKE: PatternWithId = { id: 'AKE', code: '明', label: '明出', category: 'afterNight', isWork: true, isNight: false, reportHours: 8 }
  const staff = makeStaff('M', 11, (i) => ({
    workConditions: i < 8 ? { workablePatternIds: ['B', 'M3', 'N', 'AKE'] } : { workablePatternIds: ['B', 'M3'] },
  }))
  return baseInput({
    staff,
    shiftPatterns: [OFF, PAID, B, M3, N, AKE],
    rules: [need('N', 'exact', 1), need('B', 'atLeast', 3), need('M3', 'atLeast', 1), need('B', 'atLeast', 4, WEEKDAYS, 'soft')],
    settings: baseSettings({ nightMode: 'ake', akeRequiresOffNextDay: true, nightPrecedingPatternId: 'M3' }),
    wishes: makeWishes(staff, 202),
  })
}

export function akeWorkGender(): GenerateInput {
  const BM = day('B2M', '09:00', '18:00')
  const BF = day('B2F', '09:00', '18:00')
  const NM = night('N8M', '16:00', '09:00')
  const NF = night('N8F', '16:00', '09:00')
  const AKE: PatternWithId = { id: 'AKE', code: '明', label: '明出', category: 'afterNight', isWork: true, isNight: false }
  const men = makeStaff('GM', 8, () => ({ workConditions: { workablePatternIds: ['B2M', 'N8M', 'AKE'] } }))
  const women = makeStaff('GF', 7, () => ({ workConditions: { workablePatternIds: ['B2F', 'N8F', 'AKE'] } }))
  const staff = [...men, ...women]
  return baseInput({
    staff,
    shiftPatterns: [OFF, PAID, BM, BF, NM, NF, AKE],
    rules: [
      need('N8M', 'exact', 1),
      need('N8F', 'exact', 1),
      need('B2M', 'atLeast', 2),
      need('B2F', 'atLeast', 2),
      need('B2M', 'atLeast', 3, WEEKDAYS, 'soft'),
      need('B2F', 'atLeast', 3, WEEKDAYS, 'soft'),
    ],
    settings: baseSettings({ nightMode: 'ake', akeRequiresOffNextDay: true }),
    wishes: makeWishes(staff, 303),
  })
}

export function akeRestLowFill(): GenerateInput {
  const A = day('A', '07:00', '16:00')
  const C = day('C', '10:00', '19:00')
  const B1 = day('B1', '09:00', '18:00', { lowFillPriority: true })
  const N1 = night('N1', '21:00', '07:00')
  const AKE_REST: PatternWithId = { id: 'AKER', code: '明休', label: '明休', category: 'afterNight', isWork: false, isNight: false }
  const staff = makeStaff('R', 9, (i) =>
    i < 7
      ? { workConditions: { workablePatternIds: ['A', 'C', 'B1', 'N1'] } }
      : { employmentTypeId: 'part', workConditions: { workablePatternIds: ['A', 'C', 'B1'], maxWorkdaysPerMonth: 12 } },
  )
  return baseInput({
    staff,
    shiftPatterns: [OFF, PAID, A, C, B1, N1, AKE_REST],
    rules: [need('N1', 'exact', 1), need('A', 'atLeast', 2), need('C', 'atLeast', 2), need('A', 'atLeast', 3, WEEKEND, 'soft')],
    settings: baseSettings({
      nightMode: 'ake',
      akeRequiresOffNextDay: false,
      akeAllowConsecutiveNights: true,
      shiftConsecutiveCaps: { N1: 2 },
    }),
    wishes: makeWishes(staff, 404),
  })
}

export const BENCH_FACILITIES: { key: string; label: string; build: () => GenerateInput }[] = [
  { key: 'directNight', label: '夜勤→公休直行', build: directNight },
  { key: 'akeWorkPreNight', label: '明出→公休＋夜勤前日M3', build: akeWorkPreNight },
  { key: 'akeWorkGender', label: '明出→公休＋男女別', build: akeWorkGender },
  { key: 'akeRestLowFill', label: '明休＋B1後回し', build: akeRestLowFill },
]

/** テスト用: 呼ぶたびに 1ms 進む時計。時間で打ち切る処理が、決まった回数で止まる */
export function steppingClock(): () => number {
  let t = 0
  return () => ++t
}

export type { GenerationConfig }
