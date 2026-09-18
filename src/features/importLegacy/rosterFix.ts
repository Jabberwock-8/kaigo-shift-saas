/**
 * 職員名簿（職種・資格・非常勤の上限日数、および新規職員の追加）を
 * 正式な名簿どおりに一括反映する一時的な修正ツール。
 * 既存職員は氏名で照合し、jobTypeId・qualifications・（指定があれば）maxWorkdaysPerMonth のみ更新する
 * （勤務可能パターン等の既存設定は変更しない）。
 */
import {
  fetchStaffList,
  listEmploymentTypes,
  listJobTypes,
  upsertJobType,
  upsertStaff,
} from '../../lib/firestore'
import type { EmploymentType } from '../../types/models'

export interface RosterEntry {
  name: string
  employment: '常勤' | '非常勤'
  qualification: string | null
  jobTypeLabel: string
  /** 指定があるときだけ月間上限日数を上書きする */
  maxWorkdaysPerMonth?: number
}

export const ROSTER: RosterEntry[] = [
  { name: '森　朱美', employment: '常勤', qualification: '介福', jobTypeLabel: '管理者・サービス管理責任者' },
  { name: '福島　雅子', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '神山　友菜', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '川上　久子', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '安田　三奈恵', employment: '常勤', qualification: '社福', jobTypeLabel: '生活支援員' },
  { name: '高田　照代', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: 'ペレラ　ミトゥニ　テシカ', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '増山　直央', employment: '常勤', qualification: null, jobTypeLabel: '生活支援員' },
  { name: '丹羽　美颯', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '坂口　理恵', employment: '常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '近藤　ひなた', employment: '常勤', qualification: '保育士', jobTypeLabel: '生活支援員' },
  { name: '水谷　真理枝', employment: '常勤', qualification: '初任研', jobTypeLabel: '生活支援員' },
  { name: '出村　けい子', employment: '非常勤', qualification: '介福', jobTypeLabel: '生活支援員', maxWorkdaysPerMonth: 15 },
  { name: '竹内　知恵美', employment: '非常勤', qualification: '実務者', jobTypeLabel: '生活支援員', maxWorkdaysPerMonth: 13 },
  { name: '大橋　弘美', employment: '非常勤', qualification: '介福', jobTypeLabel: '生活支援員', maxWorkdaysPerMonth: 13 },
  { name: '松岡　冨美代', employment: '非常勤', qualification: '初任研', jobTypeLabel: '生活支援員', maxWorkdaysPerMonth: 13 },
  { name: '水野　恵子', employment: '非常勤', qualification: '介福', jobTypeLabel: '生活支援員' },
  { name: '三島　人美', employment: '常勤', qualification: null, jobTypeLabel: '生活支援員' },
]

export async function applyRosterFix(facilityId: string): Promise<string[]> {
  const log: string[] = []
  const [existingStaff, existingJobTypes, existingEmploymentTypes] = await Promise.all([
    fetchStaffList(facilityId),
    listJobTypes(facilityId),
    listEmploymentTypes(facilityId),
  ])

  // 1. 職種（見つからなければ新規作成）
  const jobTypeIdByLabel = new Map(existingJobTypes.map((j) => [j.label, j.id]))
  let jtOrder = existingJobTypes.reduce((max, j) => Math.max(max, j.order ?? 0), 0)
  const neededLabels = [...new Set(ROSTER.map((e) => e.jobTypeLabel))]
  let newJobTypes = 0
  for (const label of neededLabels) {
    if (jobTypeIdByLabel.has(label)) continue
    jtOrder += 1
    const id = await upsertJobType(facilityId, null, { label, order: jtOrder })
    jobTypeIdByLabel.set(label, id)
    newJobTypes++
  }
  log.push(`職種: 新規 ${newJobTypes}件（${neededLabels.join('・')}）`)

  const employmentIdByLabel = new Map<string, string>()
  for (const e of existingEmploymentTypes as (EmploymentType & { id: string })[]) {
    employmentIdByLabel.set(e.label, e.id)
  }

  // 2. 職員（氏名で照合。既存は職種・資格・（指定があれば）上限日数のみ更新、無ければ新規登録）
  let staffOrder = existingStaff.reduce((max, s) => Math.max(max, s.order ?? 0), 0)
  let created = 0
  let updated = 0
  for (const entry of ROSTER) {
    const jobTypeId = jobTypeIdByLabel.get(entry.jobTypeLabel)
    if (!jobTypeId) continue
    const qualifications = entry.qualification ? [entry.qualification] : []
    const existing = existingStaff.find((s) => s.name === entry.name)

    if (existing) {
      const { id: _existingId, ...existingData } = existing
      void _existingId
      const workConditions = { ...(existingData.workConditions ?? {}) }
      if (entry.maxWorkdaysPerMonth != null) workConditions.maxWorkdaysPerMonth = entry.maxWorkdaysPerMonth
      await upsertStaff(facilityId, existing.id, {
        ...existingData,
        employmentTypeId: employmentIdByLabel.get(entry.employment) ?? existingData.employmentTypeId ?? '',
        jobTypeIds: [jobTypeId],
        qualifications,
        workConditions,
      })
      updated++
    } else {
      staffOrder += 1
      await upsertStaff(facilityId, null, {
        name: entry.name,
        employmentTypeId: employmentIdByLabel.get(entry.employment) ?? '',
        jobTypeIds: [jobTypeId],
        active: true,
        order: staffOrder,
        qualifications,
        traits: [],
        workConditions: {
          maxWorkdaysPerMonth: entry.maxWorkdaysPerMonth ?? 21,
          targetWorkdaysPerMonth: entry.employment === '常勤' ? (entry.maxWorkdaysPerMonth ?? 21) : null,
        },
      })
      created++
    }
  }
  log.push(`職員: 新規 ${created}名 / 更新 ${updated}名`)

  return log
}
