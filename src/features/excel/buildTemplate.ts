/**
 * Excelテンプレートの生成（P7a）。旧版はテンプレをbase64で内蔵していたが、
 * 新版はSheetJSでその場生成する（無駄なバイナリ同梱を排除）。
 * シート構成・列は docs/legacy-html-analysis.md §5 / firestore-design.md §10 のとおり。
 */
import * as XLSX from 'xlsx'
import { boolLabel } from './labels'
import type {
  EmploymentType,
  Rule,
  ShiftPattern,
  ShiftRulesSettings,
  Staff,
} from '../../types/models'
import { DAYS_TYPE_LABELS, TARGET_TYPE_LABELS, COND_TYPE_LABELS, DOW_LABELS } from './labels'

type PatternWithId = ShiftPattern & { id: string }
type StaffWithId = Staff & { id: string }
type EmploymentTypeWithId = EmploymentType & { id: string }
type RuleWithId = Rule & { id: string }

export interface TemplateData {
  facilityName: string
  settings: ShiftRulesSettings
  shiftPatterns: PatternWithId[]
  staff: StaffWithId[]
  employmentTypes: EmploymentTypeWithId[]
  rules: RuleWithId[]
}

const USAGE_LINES = [
  '【使い方】',
  '・このファイルは介護シフト作成システムの施設データ用テンプレートです。',
  '・各シートの1行目（見出し）は変更しないでください。',
  '・「※」で始まる行は説明用のサンプルです。読み込み時は無視されるので、削除するか実データに書き換えてください。',
  '・記号・氏名は「勤務記号」「職員」シートに登録したものと完全に一致させてください（取込時に照合します）。',
  '・複数値はカンマ「,」区切りで入力してください（例: A2,B1,B2）。',
  '・入力が終わったら「旧データ取込」画面（今後Excel取込画面に統合予定）からアップロードしてください。',
]

function usageSheet(): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(USAGE_LINES.map((line) => [line]))
}

function facilityInfoSheet(facilityName: string, settings: ShiftRulesSettings | null): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    ['項目', '値'],
    ['施設名', facilityName],
    [
      '夜勤明けの扱い',
      settings?.nightMode === 'direct' ? '公休に直行' : settings?.nightMode === 'ake' ? '明を使う' : '',
    ],
    ['夜勤の2日後に避ける勤務（記号カンマ区切り）', ''],
    ['最低休息時間（時間）', settings?.minRestHours ?? ''],
  ]
  return XLSX.utils.aoa_to_sheet(rows)
}

function shiftPatternsSheet(patterns: PatternWithId[]): XLSX.WorkSheet {
  const header = ['記号', '名称', '開始', '終了', '勤務', '夜勤']
  const rows: (string | number)[][] = [header]
  if (patterns.length === 0) {
    rows.push(['※A2', '※A2（早出）', '07:00', '16:00', 'はい', 'いいえ'])
  }
  for (const p of patterns) {
    if (p.isSystem) continue // 公休・有給・夜勤明けはシステム固定のため出力しない（旧版も固定付与）
    rows.push([p.code, p.label, p.startTime ?? '', p.endTime ?? '', boolLabel(p.isWork), boolLabel(p.isNight)])
  }
  return XLSX.utils.aoa_to_sheet(rows)
}

function staffSheet(
  staff: StaffWithId[],
  employmentTypes: EmploymentTypeWithId[],
  patterns: PatternWithId[],
): XLSX.WorkSheet {
  const header = [
    '氏名',
    '雇用形態',
    '必要勤務日数',
    '最大勤務日数',
    '対応可能勤務（記号カンマ区切り）',
    '資格（カンマ区切り）',
    '特性タグ（カンマ区切り）',
    '月間夜勤回数目標',
    '固定休み曜日（カンマ区切り）',
  ]
  const employmentLabelById = new Map(employmentTypes.map((e) => [e.id, e.label]))
  const codeById = new Map(patterns.map((p) => [p.id, p.code]))
  const rows: (string | number)[][] = [header]
  if (staff.length === 0) {
    rows.push(['※山田　太郎', '常勤', 21, 21, 'A2,B1,B2', '介護福祉士', '', '', ''])
  }
  for (const s of staff) {
    const wc = s.workConditions ?? {}
    rows.push([
      s.name,
      employmentLabelById.get(s.employmentTypeId ?? '') ?? '',
      wc.targetWorkdaysPerMonth ?? '',
      wc.maxWorkdaysPerMonth ?? '',
      (wc.workablePatternIds ?? []).map((id) => codeById.get(id) ?? id).join(','),
      (s.qualifications ?? []).join(','),
      (s.traits ?? []).join(','),
      wc.nightShiftTarget ?? '',
      (wc.fixedOffWeekdays ?? []).map((d) => DOW_LABELS[d]).join(','),
    ])
  }
  return XLSX.utils.aoa_to_sheet(rows)
}

function rulesSheet(
  rules: RuleWithId[],
  patternById: Map<string, PatternWithId>,
  staffById: Map<string, StaffWithId>,
): XLSX.WorkSheet {
  const header = ['有効', '必須・推奨', '対象日タイプ', '対象日詳細', '対象タイプ', '値1', '値2', '条件タイプ', '人数']
  const rows: (string | number)[][] = [header]
  if (rules.length === 0) {
    rows.push(['はい', '必須', '毎日', '', 'シフト種別', 'A2', '', 'N名以上配置', 1])
  }
  for (const r of rules) {
    const daysDetail =
      r.days.type === 'dow'
        ? ((r.days.values as number[] | undefined) ?? []).map((v) => DOW_LABELS[v]).join(',')
        : r.days.type === 'dates'
          ? ((r.days.values as string[] | undefined) ?? []).join(',')
          : ''
    let v1 = ''
    let v2 = ''
    if (r.target.type === 'shift') v1 = patternById.get(r.target.value as string)?.code ?? ''
    else if (r.target.type === 'qualification' || r.target.type === 'trait') v1 = String(r.target.value ?? '')
    else if (r.target.type === 'staff') v1 = staffById.get(r.target.value as string)?.name ?? ''
    else if (r.target.type === 'traitPair') {
      v1 = String(r.target.value ?? '')
      v2 = String(r.target.value2 ?? '')
    } else if (r.target.type === 'shiftGroup') {
      v1 = ((r.target.value as string[] | undefined) ?? []).map((id) => patternById.get(id)?.code ?? id).join(',')
    }
    if (r.cond.type === 'preferShift') v2 = patternById.get(r.cond.value ?? '')?.code ?? ''
    rows.push([
      boolLabel(r.enabled),
      r.kind === 'soft' ? '推奨' : '必須',
      DAYS_TYPE_LABELS[r.days.type],
      daysDetail,
      TARGET_TYPE_LABELS[r.target.type],
      v1,
      v2,
      COND_TYPE_LABELS[r.cond.type],
      r.cond.count ?? '',
    ])
  }
  return XLSX.utils.aoa_to_sheet(rows)
}

function scheduleActualSheet(): XLSX.WorkSheet {
  const header = ['年月(YYYY-MM)', '日', '氏名', '記号']
  return XLSX.utils.aoa_to_sheet([header])
}

export function buildTemplateWorkbook(data: TemplateData | null): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, usageSheet(), '使い方')
  XLSX.utils.book_append_sheet(wb, facilityInfoSheet(data?.facilityName ?? '', data?.settings ?? null), '施設情報')
  XLSX.utils.book_append_sheet(wb, shiftPatternsSheet(data?.shiftPatterns ?? []), '勤務記号')
  XLSX.utils.book_append_sheet(
    wb,
    staffSheet(data?.staff ?? [], data?.employmentTypes ?? [], data?.shiftPatterns ?? []),
    '職員',
  )

  const patternById = new Map((data?.shiftPatterns ?? []).map((p) => [p.id, p]))
  const staffById = new Map((data?.staff ?? []).map((s) => [s.id, s]))
  XLSX.utils.book_append_sheet(wb, rulesSheet(data?.rules ?? [], patternById, staffById), '条件')
  XLSX.utils.book_append_sheet(wb, scheduleActualSheet(), '勤務実績（任意）')
  return wb
}

export function downloadTemplateWorkbook(data: TemplateData | null, fileName: string) {
  const wb = buildTemplateWorkbook(data)
  XLSX.writeFile(wb, fileName)
}
