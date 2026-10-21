/**
 * アプリの勤務表から、市の提出様式（勤務形態一覧表）の職員の行を組み立てる（純関数）。
 * 同じ事業所の複数の施設（第二恵光の男性棟・女性棟など）をまとめて1枚にするため、施設ごとのデータを並べて受け取る。
 */
import { shiftDurationHours } from '../../lib/dateUtils'
import { employmentTypeUsesTargetWorkdays } from '../../domain/scheduler/limits'
import type { EmploymentType, JobType, ShiftPattern, Staff } from '../../types/models'
import type { SubmissionStaffRow } from './fillSubmissionForm'
import { JOB_TITLE_ORDER } from './serviceTypes'

type WithId<T> = T & { id: string }

export interface SubmissionFacilityData {
  staff: WithId<Staff>[]
  shiftPatterns: WithId<ShiftPattern>[]
  jobTypes: WithId<JobType>[]
  employmentTypes: WithId<EmploymentType>[]
  /** staffId -> 日 -> 勤務パターンID */
  assignments: Record<string, Record<string, string>>
}

/** 勤務パターン1つの、様式に書く1日の時間。休暇（有給）は「休」、休み・夜勤明けの休み扱いは null */
export function reportHoursOf(p: ShiftPattern | undefined): number | '休' | null {
  if (!p) return null
  if (p.category === 'paidLeave') return '休'
  if (p.reportHours != null) return p.reportHours
  if (!p.isWork) return null
  return shiftDurationHours(p.startTime, p.endTime, p.breakHours)
}

/** 勤務形態の既定: 常勤（必要勤務日数のある雇用区分）なら A、それ以外は C */
export function defaultWorkStyle(employmentType: EmploymentType | undefined): 'A' | 'C' {
  return employmentTypeUsesTargetWorkdays(employmentType) ? 'A' : 'C'
}

function jobOrder(title: string): number {
  const i = JOB_TITLE_ORDER.indexOf(title)
  return i === -1 ? JOB_TITLE_ORDER.length : i
}

export function buildSubmissionRows(facilities: SubmissionFacilityData[], daysInMonth: number): SubmissionStaffRow[] {
  const rows: (SubmissionStaffRow & { sort: [number, number, number] })[] = []
  facilities.forEach((f, fi) => {
    const patternById = new Map(f.shiftPatterns.map((p) => [p.id, p]))
    const jobLabel = new Map(f.jobTypes.map((j) => [j.id, j.label]))
    const empById = new Map(f.employmentTypes.map((e) => [e.id, e]))
    for (const s of f.staff) {
      if (s.active === false) continue
      const r = s.report ?? {}
      const firstJob = (s.jobTypeIds ?? []).map((id) => jobLabel.get(id)).find(Boolean) ?? jobLabel.get(s.jobTypeId ?? '')
      const jobTitle = r.jobTitle || firstJob || ''
      const byDay = f.assignments[s.id] ?? {}
      rows.push({
        jobTitle,
        workStyle: r.workStyle ?? defaultWorkStyle(empById.get(s.employmentTypeId ?? '')),
        qualification: r.qualification ?? (s.qualifications ?? []).join('・'),
        name: s.name.replace(/　/g, ' '),
        hours: Array.from({ length: 31 }, (_, i) =>
          i < daysInMonth ? reportHoursOf(patternById.get(byDay[String(i + 1)] ?? '')) : null,
        ),
        note: r.note ?? undefined,
        sort: [jobOrder(jobTitle), fi, s.order ?? 9999],
      })
    }
  })
  // 職種ごとにまとめる（同じ職種の中は施設→職員の並び順）
  rows.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2])
  return rows.map(({ sort: _sort, ...row }) => row)
}
