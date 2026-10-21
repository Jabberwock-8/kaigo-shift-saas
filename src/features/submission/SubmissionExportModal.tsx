import { useEffect, useState } from 'react'
import Modal from '../../components/Modal'
import {
  DEFAULT_SUBMISSION_SETTINGS,
  fetchSchedule,
  fetchStaffList,
  fetchSubmissionSettings,
  listEmploymentTypes,
  listJobTypes,
  listShiftPatterns,
  saveSubmissionSettings,
} from '../../lib/firestore'
import { daysInMonth as daysInMonthOf, formatYearMonthLabel } from '../../lib/dateUtils'
import type { Facility, SubmissionSettings } from '../../types/models'
import { buildSubmissionRows, type SubmissionFacilityData } from './buildSubmissionRows'
import { sheetForServiceType, SUBMISSION_TEMPLATE_LABEL, SUBMISSION_TEMPLATE_URL } from './serviceTypes'

type FacilityWithId = Facility & { id: string }

interface Props {
  /** 1枚にまとめる施設（同じ事業所名の施設）。先頭が今開いている施設 */
  facilities: FacilityWithId[]
  yearMonth: string
  isAdmin: boolean
  onClose: () => void
}

function toNumberOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * 市の提出様式（勤務形態一覧表）で出力する。同じ事業所名の施設をまとめて1枚にする。
 * docs/remaining-work-design.md §16 参照。
 */
export default function SubmissionExportModal({ facilities, yearMonth, isAdmin, onClose }: Props) {
  const main = facilities[0]
  const [settings, setSettings] = useState<SubmissionSettings>(DEFAULT_SUBMISSION_SETTINGS)
  const [planOrActual, setPlanOrActual] = useState<'予定' | '実績'>('予定')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    void fetchSubmissionSettings(main.id).then(setSettings)
  }, [main.id])

  const sheet = sheetForServiceType(main.serviceType)
  const officeName = main.officeName || main.name

  async function handleExport() {
    if (!sheet) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const days = daysInMonthOf(yearMonth)
      const data: SubmissionFacilityData[] = []
      for (const f of facilities) {
        const [staff, shiftPatterns, jobTypes, employmentTypes, schedule] = await Promise.all([
          fetchStaffList(f.id),
          listShiftPatterns(f.id),
          listJobTypes(f.id),
          listEmploymentTypes(f.id),
          fetchSchedule(f.id, yearMonth),
        ])
        data.push({ staff, shiftPatterns, jobTypes, employmentTypes, assignments: schedule?.assignments ?? {} })
      }
      const rows = buildSubmissionRows(data, days)
      const res = await fetch(SUBMISSION_TEMPLATE_URL)
      if (!res.ok) throw new Error('市の様式ファイルを読み込めませんでした。ページを再読み込みしてからやり直してください。')
      const template = await res.arrayBuffer()
      // exceljs は大きいので、出力するときだけ読み込む
      const { fillSubmissionForm } = await import('./fillSubmissionForm')
      const buf = await fillSubmissionForm({
        template,
        sheetName: sheet,
        yearMonth,
        officeName,
        period: settings.period,
        planOrActual,
        hoursPerWeek: settings.hoursPerWeek,
        hoursPerMonth: settings.hoursPerMonth,
        rows,
      })
      const fileName = `勤務形態一覧表_${officeName.replace(/[\\/:*?"<>|]/g, '_')}_${formatYearMonthLabel(yearMonth)}_${planOrActual}.xlsx`
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      if (isAdmin) await saveSubmissionSettings(main.id, settings)
      setDone(`${fileName} を保存しました（職員 ${rows.length}名）。`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`市の提出様式で出力（${formatYearMonthLabel(yearMonth)}）`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="primary" onClick={() => void handleExport()} disabled={!sheet || busy}>
            {busy ? '作成中…' : '📄 Excel を作成'}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            閉じる
          </button>
        </>
      }
    >
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {SUBMISSION_TEMPLATE_LABEL}「従業者の勤務の体制及び勤務形態一覧表」に、この月の勤務表を書き込みます。
          合計時間・週平均・常勤換算は様式の計算式で計算されます。利用者の人数などの欄は空けてあるので、Excel で入力してください。
        </p>
        {!sheet ? (
          <p className="warn">
            この施設のサービス種別が未設定です。「⚙️ 施設・ユーザー管理」の施設の ✎ から、サービス種別を選んでください。
          </p>
        ) : (
          <>
            <p>
              事業所名: <strong>{officeName}</strong>　サービス種別: <strong>{main.serviceType}</strong>
              <br />
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                まとめる施設: {facilities.map((f) => f.shortName || f.name).join('・')}
              </span>
            </p>
            <div className="form-stack" style={{ gap: 10 }}>
              <label className="field-row">
                予定／実績
                <select value={planOrActual} onChange={(e) => setPlanOrActual(e.target.value as '予定' | '実績')}>
                  <option value="予定">予定</option>
                  <option value="実績">実績</option>
                </select>
              </label>
              <label className="field-row">
                記載する期間
                <select
                  value={settings.period}
                  onChange={(e) => setSettings((s) => ({ ...s, period: e.target.value as SubmissionSettings['period'] }))}
                >
                  <option value="暦月">暦月</option>
                  <option value="４週">４週</option>
                </select>
              </label>
              <label className="field-row">
                常勤の従業者が勤務すべき時間数
                <input
                  type="number"
                  style={{ width: 80 }}
                  value={settings.hoursPerWeek ?? ''}
                  onChange={(e) => setSettings((s) => ({ ...s, hoursPerWeek: toNumberOrNull(e.target.value) }))}
                />
                時間/週
                <input
                  type="number"
                  style={{ width: 80 }}
                  value={settings.hoursPerMonth ?? ''}
                  placeholder="例: 168"
                  onChange={(e) => setSettings((s) => ({ ...s, hoursPerMonth: toNumberOrNull(e.target.value) }))}
                />
                時間/月
              </label>
            </div>
          </>
        )}
        {error && <p className="warn">{error}</p>}
        {done && <p className="ok">✅ {done}</p>}
    </Modal>
  )
}
