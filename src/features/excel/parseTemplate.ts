/**
 * Excelテンプレートの取込（P7b 手順1）。旧版 parseExcelTemplate と同じ寛容パース＋warnings[]。
 * 認識できない行はスキップして警告に積む（丸ごと差し替えではなく、後段のdiff.tsで差分反映する）。
 * このファイルではまだFirestoreへは触れない。記号・氏名をキーにした「draft」を返すだけ。
 */
import * as XLSX from 'xlsx'
import type { RuleCond, RuleDays, RuleTarget } from '../../types/models'
import {
  COND_TYPE_BY_LABEL,
  DAYS_TYPE_BY_LABEL,
  DOW_BY_LABEL,
  TARGET_TYPE_BY_LABEL,
  excelBool,
  normTime,
  splitList,
} from './labels'

export interface ParsedShiftPattern {
  code: string
  label: string
  startTime: string
  endTime: string
  isWork: boolean
  isNight: boolean
}

export interface ParsedStaff {
  name: string
  employment: string
  targetWorkdaysPerMonth: number | null
  maxWorkdaysPerMonth: number | null
  workablePatternCodes: string[]
  qualifications: string[]
  traits: string[]
  nightShiftTarget: number | null
  fixedOffWeekdays: number[]
}

/** target/cond の value は、勤務記号なら「記号」、職員なら「氏名」を仮のキーとして持つ（diff.ts でIDへ解決する） */
export interface ParsedRule {
  enabled: boolean
  kind: 'hard' | 'soft'
  days: RuleDays
  target: RuleTarget
  cond: RuleCond
}

export interface ParsedFacilityInfo {
  facilityName: string
  nightMode: 'ake' | 'direct' | null
  nightAvoidPatternCodes: string[]
  minRestHours: number | null
}

export interface TemplateDraft {
  facility: ParsedFacilityInfo
  shiftPatterns: ParsedShiftPattern[]
  staff: ParsedStaff[]
  rules: ParsedRule[]
}

export interface ParseResult {
  draft: TemplateDraft
  warnings: string[]
}

function sheetRows(wb: XLSX.WorkBook, name: string): string[][] | null {
  const ws = wb.Sheets[name]
  if (!ws) return null
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false, blankrows: false })
}

function cell(row: string[], i: number): string {
  return String(row[i] ?? '').trim()
}

export function parseTemplateWorkbook(wb: XLSX.WorkBook): ParseResult {
  const warnings: string[] = []
  const draft: TemplateDraft = {
    facility: { facilityName: '', nightMode: null, nightAvoidPatternCodes: [], minRestHours: null },
    shiftPatterns: [],
    staff: [],
    rules: [],
  }

  // 施設情報
  const fi = sheetRows(wb, '施設情報')
  if (fi) {
    for (let i = 1; i < fi.length; i++) {
      const k = cell(fi[i], 0)
      const v = cell(fi[i], 1)
      if (k === '施設名') draft.facility.facilityName = v
      if (k === '夜勤明けの扱い') draft.facility.nightMode = v === '公休に直行' ? 'direct' : v === '明を使う' ? 'ake' : null
      if (k.startsWith('夜勤の2日後に避ける')) draft.facility.nightAvoidPatternCodes = splitList(v)
      if (k.startsWith('最低休息時間')) {
        const n = parseFloat(v)
        if (!Number.isNaN(n) && n > 0) draft.facility.minRestHours = n
      }
    }
  } else {
    warnings.push('「施設情報」シートが見つかりませんでした')
  }

  // 勤務記号
  const knownCodes = new Set<string>()
  const stRows = sheetRows(wb, '勤務記号')
  if (stRows) {
    for (let i = 1; i < stRows.length; i++) {
      const row = stRows[i]
      const code = cell(row, 0)
      if (!code || code.startsWith('※')) continue
      const label = cell(row, 1) || code
      const isWork = excelBool(row[4])
      const isNight = excelBool(row[5])
      knownCodes.add(code)
      draft.shiftPatterns.push({ code, label, startTime: normTime(row[2]), endTime: normTime(row[3]), isWork, isNight })
    }
  } else {
    warnings.push('「勤務記号」シートが見つかりませんでした')
  }
  // 公休・有給は勤務記号シートに書かせない（システム固定・既存パターンと紐付けるため）
  knownCodes.add('公休')
  knownCodes.add('休')
  knownCodes.add('有給')
  knownCodes.add('有')

  // 職員
  const knownNames = new Set<string>()
  const stf = sheetRows(wb, '職員')
  if (stf) {
    for (let i = 1; i < stf.length; i++) {
      const row = stf[i]
      const name = cell(row, 0)
      if (!name || name.startsWith('※')) continue
      const employment = cell(row, 1) || '常勤'
      const targetRaw = cell(row, 2)
      const maxRaw = cell(row, 3)
      const target = targetRaw !== '' ? Math.max(0, parseInt(targetRaw, 10) || 0) : null
      const max = maxRaw !== '' ? Math.max(0, parseInt(maxRaw, 10) || 0) : target
      const allowedCodes = splitList(row[4])
      const qualifications = splitList(row[5])
      const traits = splitList(row[6])
      const nightRaw = cell(row, 7)
      const nightShiftTarget = nightRaw !== '' ? Math.max(0, parseInt(nightRaw, 10) || 0) : null
      const fixedOffDowLabels = splitList(row[8])

      knownNames.add(name)
      const workablePatternCodes = allowedCodes.filter((c) => {
        if (knownCodes.has(c)) return true
        warnings.push(`職員「${name}」の対応可能勤務「${c}」は勤務記号シートに見つかりません（無視されます）`)
        return false
      })
      const fixedOffWeekdays: number[] = []
      for (const dLabel of fixedOffDowLabels) {
        const dow = DOW_BY_LABEL[dLabel]
        if (dow === undefined) {
          warnings.push(`職員「${name}」の固定休み曜日「${dLabel}」を認識できません`)
          continue
        }
        fixedOffWeekdays.push(dow)
      }

      draft.staff.push({
        name,
        employment,
        targetWorkdaysPerMonth: target,
        maxWorkdaysPerMonth: max,
        workablePatternCodes,
        qualifications,
        traits,
        nightShiftTarget,
        fixedOffWeekdays,
      })
    }
  } else {
    warnings.push('「職員」シートが見つかりませんでした')
  }

  // 条件
  const rl = sheetRows(wb, '条件')
  if (rl) {
    for (let i = 1; i < rl.length; i++) {
      const row = rl[i]
      const enabledRaw = cell(row, 0)
      const enabled = enabledRaw === '' ? true : excelBool(row[0])
      const kind: 'hard' | 'soft' = cell(row, 1) === '推奨' ? 'soft' : 'hard'
      const daysTypeJ = cell(row, 2)
      const daysDetail = cell(row, 3)
      const targetTypeJ = cell(row, 4)
      const v1 = cell(row, 5)
      const v2 = cell(row, 6)
      const condTypeJ = cell(row, 7)
      const countRaw = row[8]
      if (!daysTypeJ && !targetTypeJ && !condTypeJ) continue

      const daysType = DAYS_TYPE_BY_LABEL[daysTypeJ]
      const targetType = TARGET_TYPE_BY_LABEL[targetTypeJ]
      const condType = COND_TYPE_BY_LABEL[condTypeJ]
      if (!daysType || !targetType || !condType) {
        warnings.push(`条件シート ${i + 1}行目: 項目を認識できないためスキップしました`)
        continue
      }

      const days: RuleDays = { type: daysType }
      if (daysType === 'dow') {
        const values = splitList(daysDetail)
          .map((s) => DOW_BY_LABEL[s])
          .filter((v): v is number => v !== undefined)
        if (!values.length) {
          warnings.push(`条件シート ${i + 1}行目: 曜日を認識できませんでした`)
          continue
        }
        days.values = values
      }
      if (daysType === 'dates') days.values = splitList(daysDetail)

      let target: RuleTarget
      if (targetType === 'shift' || targetType === 'secondaryShift') {
        if (!knownCodes.has(v1)) {
          warnings.push(`条件シート ${i + 1}行目: 勤務記号「${v1}」が見つかりません`)
          continue
        }
        target = { type: targetType, value: v1 }
      } else if (targetType === 'qualification' || targetType === 'trait') {
        target = { type: targetType, value: v1 }
      } else if (targetType === 'staff') {
        if (!knownNames.has(v1)) {
          warnings.push(`条件シート ${i + 1}行目: 職員「${v1}」が見つかりません`)
          continue
        }
        target = { type: 'staff', value: v1 }
      } else if (targetType === 'traitPair') {
        target = { type: 'traitPair', value: v1, value2: v2 }
      } else {
        const codes = splitList(v1).filter((c) => {
          if (knownCodes.has(c)) return true
          warnings.push(`条件シート ${i + 1}行目: 勤務記号「${c}」が見つかりません`)
          return false
        })
        if (codes.length < 2) {
          warnings.push(`条件シート ${i + 1}行目: シフトの組み合わせは2つ以上指定してください`)
          continue
        }
        target = { type: 'shiftGroup', value: codes }
      }

      const cond: RuleCond = { type: condType }
      if (condType === 'atLeast' || condType === 'exact' || condType === 'atMost' || condType === 'atLeastGroup') {
        cond.count = Math.max(0, parseInt(String(countRaw ?? ''), 10) || 0)
      }
      if (condType === 'preferShift') {
        if (!knownCodes.has(v2)) {
          warnings.push(`条件シート ${i + 1}行目: 優先するシフト「${v2}」が見つかりません`)
          continue
        }
        cond.value = v2
      }

      draft.rules.push({ enabled, kind, days, target, cond })
    }
  }

  return { draft, warnings }
}
