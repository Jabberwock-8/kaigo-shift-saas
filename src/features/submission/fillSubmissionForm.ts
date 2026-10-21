/**
 * 岐阜市「従業者の勤務の体制及び勤務形態一覧表」（参考様式10・令和8年7月版）に勤務表を書き込む。
 * 市の様式ファイルをひな形にし、罫線・計算式・入力の選択肢を残したまま、該当するサービス種別のシートだけを残して保存する。
 * 職員の欄は20行（11〜30行目）しかないため、足りないときは行を足し、下の計算式・結合・選択肢をずらして直す。
 * docs/remaining-work-design.md §16 参照。
 */
import ExcelJS from 'exceljs'

/** 様式の職員の欄の最初と最後の行（ひな形のまま） */
const FIRST_ROW = 11
const LAST_ROW = 30
/** 日ごとの勤務時間の最初の列（F=6）。1日が F、31日が AJ */
const FIRST_DAY_COL = 6
const COLS = 40 // A〜AN

export interface SubmissionStaffRow {
  /** (4) 職種（様式の選択肢の名称に合わせる。例: 生活支援員） */
  jobTitle: string
  /** (5) 勤務形態 A:常勤専従 B:常勤兼務 C:非常勤専従 D:非常勤兼務 */
  workStyle: 'A' | 'B' | 'C' | 'D'
  /** (6) 資格 */
  qualification: string
  /** (7) 氏名 */
  name: string
  /** (8) 日ごとの勤務時間。添字0が1日。休暇は「休」、勤務なしは null */
  hours: (number | '休' | null)[]
  /** (11) 兼務状況など */
  note?: string
}

export interface SubmissionFormInput {
  /** ひな形（市の様式ファイル）の中身 */
  template: ArrayBuffer
  /** 使うシート名（例: 勤務形態一覧表（障害者支援施設）） */
  sheetName: string
  /** "YYYY-MM" */
  yearMonth: string
  officeName: string
  period: '暦月' | '４週'
  planOrActual: '予定' | '実績'
  /** (3) 常勤の従業者が勤務すべき時間数 */
  hoursPerWeek: number | null
  hoursPerMonth: number | null
  rows: SubmissionStaffRow[]
}

/** 様式の選択肢は「歴月」（原文のまま）。画面では正しい「暦月」で持ち、書き込むときだけ合わせる */
const PERIOD_IN_FORM: Record<SubmissionFormInput['period'], string> = { 暦月: '歴月', '４週': '４週' }

/**
 * 計算式の中のセル参照を、職員の欄を extra 行増やしたあとの位置に直す。
 * 職員の欄全体を指す範囲（11行目〜30行目）は終わりを伸ばし、30行目より下を指す参照はずらす。
 * 別のシートを指す参照（選択肢!$A$1:$J$31 など）は変えない。
 */
export function shiftFormula(formula: string, extra: number): string {
  if (extra <= 0) return formula
  const ref = String.raw`(\$?)([A-Z]{1,3})(\$?)(\d+)`
  const re = new RegExp(`${ref}(?::${ref})?`, 'g')
  return formula.replace(re, (match, a1, c1, b1, r1, a2, c2, b2, r2, offset: number, whole: string) => {
    const prev = offset > 0 ? whole[offset - 1] : ''
    // 関数名の一部・別シートの参照・文字列の中は対象外
    if (/[A-Za-z0-9_!]/.test(prev)) return match
    if (countQuotesBefore(whole, offset) % 2 === 1) return match
    const row1 = Number(r1)
    if (r2 === undefined) return `${a1}${c1}${b1}${row1 >= LAST_ROW + 1 ? row1 + extra : row1}`
    const row2 = Number(r2)
    if (row1 === FIRST_ROW && row2 === LAST_ROW) return `${a1}${c1}${b1}${row1}:${a2}${c2}${b2}${row2 + extra}`
    const s = (r: number) => (r >= LAST_ROW + 1 ? r + extra : r)
    return `${a1}${c1}${b1}${s(row1)}:${a2}${c2}${b2}${s(row2)}`
  })
}

function countQuotesBefore(s: string, end: number): number {
  let n = 0
  for (let i = 0; i < end; i++) if (s[i] === '"') n++
  return n
}

function rowOf(address: string): number {
  return Number(address.replace(/^[A-Z]+/, ''))
}

function colOf(address: string): string {
  return address.replace(/\d+$/, '')
}

/** 職員の欄を extra 行増やす（31行目の「合計」から下をずらす） */
function insertStaffRows(ws: ExcelJS.Worksheet, extra: number) {
  // 1. 共有の計算式（shared formula）は行をずらすと壊れるため、すべて個別の計算式にしてから参照を直す
  //    共有の計算式は元になるセルの式から作られるため、書き換えながら読むと2回ずれる（合計の行が自分自身を含む範囲になり、
  //    Excel で循環参照になっていた）。先に全部読み取ってから書き換える
  const formulas: { cell: ExcelJS.Cell; formula: string }[] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.type === ExcelJS.ValueType.Formula) formulas.push({ cell, formula: cell.formula })
    })
  })
  for (const { cell, formula } of formulas) {
    cell.value = { formula: shiftFormula(formula, extra) } as ExcelJS.CellFormulaValue
  }

  // 2. 下の結合は外して、ずらしてから付け直す。職員の最後の行の結合（兼務状況の欄など）は新しい行にも付ける
  const merges = Object.values((ws as unknown as { _merges: Record<string, { range: string }> })._merges).map((m) => m.range)
  const below = merges.filter((r) => rowOf(r.split(':')[0]) > LAST_ROW)
  const lastRowMerges = merges.filter((r) => rowOf(r.split(':')[0]) === LAST_ROW && rowOf(r.split(':')[1]) === LAST_ROW)
  below.forEach((r) => ws.unMergeCells(r))

  // 3. 入力の選択肢: 下にあるものはずらし、職員の最後の行のものは新しい行にも付ける
  const dv = (ws as unknown as { dataValidations: { model: Record<string, ExcelJS.DataValidation> } }).dataValidations
  const dvEntries = Object.entries(dv.model)
  const nextModel: Record<string, ExcelJS.DataValidation> = {}
  for (const [addr, v] of dvEntries) {
    const r = rowOf(addr)
    if (r > LAST_ROW) nextModel[`${colOf(addr)}${r + extra}`] = v
    else nextModel[addr] = v
    if (r === LAST_ROW) for (let i = 1; i <= extra; i++) nextModel[`${colOf(addr)}${LAST_ROW + i}`] = v
  }
  dv.model = nextModel

  // 4. 行を入れる（書式は職員の最後の行をまねる）
  const template = ws.getRow(LAST_ROW)
  ws.spliceRows(LAST_ROW + 1, 0, ...Array.from({ length: extra }, () => []))
  for (let i = 1; i <= extra; i++) {
    const row = ws.getRow(LAST_ROW + i)
    row.height = template.height
    for (let c = 1; c <= COLS; c++) row.getCell(c).style = JSON.parse(JSON.stringify(template.getCell(c).style ?? {}))
  }
  below.forEach((r) => {
    const [s, e] = r.split(':')
    ws.mergeCells(`${colOf(s)}${rowOf(s) + extra}:${colOf(e)}${rowOf(e) + extra}`)
  })
  for (let i = 1; i <= extra; i++) {
    lastRowMerges.forEach((r) => {
      const [s, e] = r.split(':')
      ws.mergeCells(`${colOf(s)}${LAST_ROW + i}:${colOf(e)}${LAST_ROW + i}`)
    })
  }

  // 5. 新しい行の計算式（勤務時間数合計・週平均）
  for (let r = LAST_ROW + 1; r <= LAST_ROW + extra; r++) {
    ws.getCell(`AK${r}`).value = { formula: `+SUM(F${r}:AJ${r})` } as ExcelJS.CellFormulaValue
    ws.getCell(`AL${r}`).value = {
      formula: `IF($AK$3="４週",AK${r}/4,AK${r}/(DAY(EOMONTH($F$9,0))/7))`,
    } as ExcelJS.CellFormulaValue
  }

  // 6. 印刷範囲を伸ばす
  const area = ws.pageSetup.printArea
  if (area) ws.pageSetup.printArea = area.replace(/(\d+)$/, (n) => String(Number(n) + extra))
}

export async function fillSubmissionForm(input: SubmissionFormInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(input.template)
  const ws = wb.getWorksheet(input.sheetName)
  if (!ws) throw new Error(`様式に「${input.sheetName}」のシートがありません。`)

  // 使うシートと、選択肢（入力の選択肢の元）だけを残す
  for (const other of [...wb.worksheets]) {
    if (other.name !== input.sheetName && other.name !== '選択肢') wb.removeWorksheet(other.id)
  }
  ws.views = (ws.views ?? []).map((v) => ({ ...v, activeCell: 'A1' }))
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]

  const extra = Math.max(0, input.rows.length - (LAST_ROW - FIRST_ROW + 1))
  if (extra > 0) insertStaffRows(ws, extra)

  // 見出し
  const [year, month] = input.yearMonth.split('-').map(Number)
  ws.getCell('M2').value = year
  ws.getCell('S2').value = month
  ws.getCell('AK2').value = input.officeName
  ws.getCell('AK3').value = PERIOD_IN_FORM[input.period]
  ws.getCell('AK4').value = input.planOrActual
  ws.getCell('AH5').value = input.hoursPerWeek
  ws.getCell('AL5').value = input.hoursPerMonth

  // 職員（ひな形の記入例は消す）
  const lastStaffRow = LAST_ROW + extra
  for (let r = FIRST_ROW; r <= lastStaffRow; r++) {
    const data = input.rows[r - FIRST_ROW]
    ws.getCell(`A${r}`).value = r - FIRST_ROW + 1
    ws.getCell(`B${r}`).value = data?.jobTitle ?? null
    ws.getCell(`C${r}`).value = data?.workStyle ?? null
    ws.getCell(`D${r}`).value = data?.qualification || null
    ws.getCell(`E${r}`).value = data?.name ?? null
    for (let d = 1; d <= 31; d++) ws.getRow(r).getCell(FIRST_DAY_COL + d - 1).value = data?.hours[d - 1] ?? null
    ws.getCell(`AM${r}`).value = data?.note || null
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
