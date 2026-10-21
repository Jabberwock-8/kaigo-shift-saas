/// <reference types="node" />
import fs from 'fs'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { fillSubmissionForm, shiftFormula } from './fillSubmissionForm'

const TEMPLATE = 'public/forms/gifu_kinmu_r80721.xlsx'
const SHEET = '勤務形態一覧表（障害者支援施設）'

describe('shiftFormula', () => {
  it('職員の欄全体（11〜30行目）の範囲は終わりを伸ばし、30行目より下はずらし、別シートは変えない', () => {
    expect(shiftFormula('COUNTIFS($B$11:$B$30,C$59,$C$11:$C$30,"A")', 25)).toBe('COUNTIFS($B$11:$B$55,C$84,$C$11:$C$55,"A")')
    expect(shiftFormula('+SUM(F11:F30)', 25)).toBe('+SUM(F11:F55)')
    expect(shiftFormula('ROUNDDOWN(IF(AL43<=60,1,1+ROUNDUP((AL43-60)/40,0)),1)', 25)).toBe(
      'ROUNDDOWN(IF(AL68<=60,1,1+ROUNDUP((AL68-60)/40,0)),1)',
    )
    expect(shiftFormula('VLOOKUP($AK$1,選択肢!$A$1:$J$31,C64,FALSE)', 25)).toBe('VLOOKUP($AK$1,選択肢!$A$1:$J$31,C89,FALSE)')
    expect(shiftFormula('IF($AK$3="４週",AK12/4,AK12/(DAY(EOMONTH($F$9,0))/7))', 25)).toBe(
      'IF($AK$3="４週",AK12/4,AK12/(DAY(EOMONTH($F$9,0))/7))',
    )
  })
})

describe('fillSubmissionForm', () => {
  const template = fs.readFileSync(TEMPLATE)
  const rows = Array.from({ length: 45 }, (_, i) => ({
    jobTitle: i === 0 ? 'サービス管理責任者' : '生活支援員',
    workStyle: (i % 4 === 3 ? 'C' : 'A') as 'A' | 'C',
    qualification: '介護福祉士',
    name: '職員' + (i + 1),
    hours: Array.from({ length: 31 }, (_, d): number | '休' | null => (d % 7 === 5 ? null : d === 10 ? '休' : 8)),
    note: i === 0 ? '管理者と兼務' : undefined,
  }))

  it('45人分を書き込み、行を足しても合計・下の計算式・結合・選択肢がずれない', async () => {
    const buf = await fillSubmissionForm({
      template: template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength),
      sheetName: SHEET,
      yearMonth: '2026-11',
      officeName: '岐阜市立第二恵光',
      period: '暦月',
      planOrActual: '予定',
      hoursPerWeek: 40,
      hoursPerMonth: 168,
      rows,
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    expect(wb.worksheets.map((w) => w.name).sort()).toEqual([SHEET, '選択肢'].sort())
    const ws = wb.getWorksheet(SHEET)!
    const v = (a: string) => ws.getCell(a).value
    const f = (a: string) => (ws.getCell(a).value as { formula?: string } | null)?.formula
    // 見出し
    expect(v('M2')).toBe(2026)
    expect(v('S2')).toBe(11)
    expect(v('AK2')).toBe('岐阜市立第二恵光')
    expect(v('AK3')).toBe('歴月')
    // 職員（45人目は 55 行目）
    expect(v('E11')).toBe('職員1')
    expect(v('E55')).toBe('職員45')
    expect(v('F55')).toBe(8)
    expect(v('P11')).toBe('休')
    expect(v('AM11')).toBe('管理者と兼務')
    expect(f('AK55')).toBe('+SUM(F55:AJ55)')
    // 合計は 56 行目、範囲は 11〜55 行目
    expect(v('A56')).toBe('合計')
    expect(f('F56')).toBe('+SUM(F11:F55)')
    // 下の計算式・結合・選択肢がずれている
    expect(f('C81')).toBe('ROUNDDOWN(IF(AL68<=60,1,1+ROUNDUP((AL68-60)/40,0)),1)')
    expect(f('C86')).toContain('$B$11:$B$55')
    expect(ws.getCell('AN55').isMerged).toBe(true)
    const dv = (ws as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model
    expect(dv['C55']).toBeTruthy()
    expect(dv['AG68']).toBeTruthy()
    expect(ws.pageSetup.printArea).toBe('A1:AN123')
  })
})
