import { useState, type ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import { fetchStaffList, fetchShiftRulesSettings, listRules } from '../../lib/firestore'
import { buildDiff, type DiffResult, type ExistingData } from './diff'
import { downloadTemplateWorkbook } from './buildTemplate'
import { parseTemplateWorkbook, type TemplateDraft } from './parseTemplate'
import { applyDiff } from './applyDiff'

/**
 * Excelテンプレートによる他施設展開・データ更新（P7）。
 * 空テンプレ／現在データ入りテンプレのダウンロードと、差分プレビュー付きの取込を行う。
 */
export default function ExcelPage() {
  const { appUser, selectedFacilityId, facilities } = useFacility()
  const { shiftPatterns, employmentTypes, refresh } = useMasters()
  const isAdmin = appUser?.role === 'admin'
  const facilityName = facilities.find((f) => f.id === selectedFacilityId)?.name ?? ''

  const [downloading, setDownloading] = useState(false)
  const [fileName, setFileName] = useState('')
  const [draft, setDraft] = useState<TemplateDraft | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [existingData, setExistingData] = useState<ExistingData | null>(null)
  const [deletePatternCodes, setDeletePatternCodes] = useState<Set<string>>(new Set())
  const [deleteStaffNames, setDeleteStaffNames] = useState<Set<string>>(new Set())
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [resultLog, setResultLog] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!selectedFacilityId) return null
  if (!isAdmin) {
    return (
      <section className="card">
        <p className="muted">この機能は管理者のみ使用できます。</p>
      </section>
    )
  }

  async function handleDownload(includeCurrentData: boolean) {
    setDownloading(true)
    setError(null)
    try {
      let data = null
      if (includeCurrentData) {
        const [staff, rules, settings] = await Promise.all([
          fetchStaffList(selectedFacilityId!),
          listRules(selectedFacilityId!),
          fetchShiftRulesSettings(selectedFacilityId!),
        ])
        data = { facilityName, settings, shiftPatterns, staff, employmentTypes, rules }
      }
      downloadTemplateWorkbook(
        data,
        includeCurrentData ? `${facilityName || '施設'}_データ.xlsx` : '介護シフト_テンプレート.xlsx',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedFacilityId) return
    setError(null)
    setResultLog(null)
    setFileName(file.name)
    setParsing(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const { draft: parsedDraft, warnings: parseWarnings } = parseTemplateWorkbook(wb)
      if (parsedDraft.staff.length === 0) {
        throw new Error('職員が1件も読み取れませんでした。「職員」シートを確認してください。')
      }
      const [staff, rules] = await Promise.all([fetchStaffList(selectedFacilityId), listRules(selectedFacilityId)])
      const existing: ExistingData = { facilityName, patterns: shiftPatterns, staff, employmentTypes, rules }
      const diffResult = buildDiff(parsedDraft, existing)
      setDraft(parsedDraft)
      setWarnings(parseWarnings)
      setExistingData(existing)
      setDiff(diffResult)
      setDeletePatternCodes(new Set())
      setDeleteStaffNames(new Set())
    } catch (err) {
      setDraft(null)
      setDiff(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }

  async function handleApply() {
    if (!selectedFacilityId || !draft || !diff || !existingData) return
    const totalDeletes = deletePatternCodes.size + deleteStaffNames.size
    if (totalDeletes > 0 && !confirm(`${totalDeletes}件を削除します。よろしいですか？`)) return
    setApplying(true)
    setError(null)
    try {
      const log = await applyDiff(selectedFacilityId, draft, diff, existingData, {
        deletePatternCodes,
        deleteStaffNames,
      })
      setResultLog(log)
      setDraft(null)
      setDiff(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  function toggleDeletePattern(code: string, checked: boolean) {
    setDeletePatternCodes((prev) => {
      const next = new Set(prev)
      if (checked) next.add(code)
      else next.delete(code)
      return next
    })
  }

  function toggleDeleteStaff(name: string, checked: boolean) {
    setDeleteStaffNames((prev) => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const changedPatterns = diff?.patterns.filter((p) => p.status !== 'unchanged') ?? []
  const changedStaff = diff?.staff.filter((s) => s.status !== 'unchanged') ?? []

  return (
    <section className="card">
      <h2>Excel入出力（他施設展開・データ更新）</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        Excelテンプレートで職員・勤務パターン・条件をまとめて登録・更新できます。取込は現在のデータとの差分をプレビューしてから反映します（丸ごと置き換えではありません）。
      </p>

      <div className="card inner" style={{ marginBottom: 14 }}>
        <h3>テンプレートのダウンロード</h3>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" onClick={() => void handleDownload(false)} disabled={downloading}>
            空テンプレをダウンロード
          </button>
          <button type="button" onClick={() => void handleDownload(true)} disabled={downloading}>
            現在のデータ入りをダウンロード
          </button>
        </div>
      </div>

      <div className="card inner">
        <h3>取込</h3>
        <div className="form-stack">
          <label>
            記入済みファイル（.xlsx）
            <input type="file" accept=".xlsx" onChange={(e) => void handleFile(e)} disabled={parsing} />
          </label>
        </div>

        {warnings.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p className="warn">読み取り時の警告（{warnings.length}件・該当行はスキップされています）</p>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {diff && (
          <div style={{ marginTop: 14 }}>
            <h4>取込内容の確認（{fileName}）</h4>
            <ul>
              <li>
                勤務パターン: 新規 {diff.patterns.filter((p) => p.status === 'new').length}件 / 変更{' '}
                {diff.patterns.filter((p) => p.status === 'changed').length}件
              </li>
              <li>
                職員: 新規 {diff.staff.filter((s) => s.status === 'new').length}名 / 変更{' '}
                {diff.staff.filter((s) => s.status === 'changed').length}名
              </li>
              <li>雇用区分: 新規 {diff.newEmploymentLabels.length}件</li>
              {diff.settingsPatch && <li>設定（夜勤運用・休息時間など）: 更新あり</li>}
              <li>
                条件ルール: 新規 {diff.newRuleCount}件
                {diff.skippedRuleCount > 0 && `（参照先が見つからず${diff.skippedRuleCount}件をスキップ）`}
              </li>
            </ul>

            {changedPatterns.length > 0 && (
              <>
                <h4>勤務パターンの新規・変更</h4>
                <ul>
                  {changedPatterns.map((p) => (
                    <li key={p.code}>
                      {p.status === 'new' ? '➕新規' : '変更'} {p.code}（{p.next.label}）
                    </li>
                  ))}
                </ul>
              </>
            )}

            {changedStaff.length > 0 && (
              <>
                <h4>職員の新規・変更</h4>
                <ul>
                  {changedStaff.map((s) => (
                    <li key={s.name}>
                      {s.status === 'new' ? '➕新規' : '変更'} {s.name}（{s.employmentLabel}）
                    </li>
                  ))}
                </ul>
              </>
            )}

            {diff.removablePatterns.length > 0 && (
              <>
                <h4>Excelに無い勤務パターン（削除は既定オフ）</h4>
                <ul className="cap-list">
                  {diff.removablePatterns.map(({ pattern, usedElsewhere }) => (
                    <li key={pattern.id}>
                      <label className="row">
                        <input
                          type="checkbox"
                          disabled={usedElsewhere}
                          checked={deletePatternCodes.has(pattern.code)}
                          onChange={(e) => toggleDeletePattern(pattern.code, e.target.checked)}
                        />
                        {pattern.code}（{pattern.label}）
                        {usedElsewhere && <span className="muted"> ※使用中のため削除不可</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {diff.removableStaff.length > 0 && (
              <>
                <h4>Excelに無い職員（削除は既定オフ）</h4>
                <ul className="cap-list">
                  {diff.removableStaff.map((s) => (
                    <li key={s.id}>
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={deleteStaffNames.has(s.name)}
                          onChange={(e) => toggleDeleteStaff(s.name, e.target.checked)}
                        />
                        {s.name}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button type="button" onClick={() => void handleApply()} disabled={applying} style={{ marginTop: 10 }}>
              {applying ? '反映中…' : 'この内容で反映する'}
            </button>
          </div>
        )}

        {resultLog && (
          <div style={{ marginTop: 14 }}>
            <h4>結果</h4>
            <ul>
              {resultLog.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p className="warn" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
