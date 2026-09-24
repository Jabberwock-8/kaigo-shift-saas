import { useState, type ChangeEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { firebaseStatus } from '../../lib/firebase'
import {
  exportFacilityData,
  importFacilityData,
  inspectImportTarget,
  type ImportTarget,
} from '../../lib/facilityTransfer'
import {
  TRANSFER_COLLECTIONS,
  TRANSFER_COLLECTION_LABELS,
  countDocs,
  parseTransferFile,
  type FacilityTransferFile,
} from '../../lib/facilityTransferCodec'
import type { Facility } from '../../types/models'

type FacilityWithId = Facility & { id: string }

/** Firebase のプロジェクトIDを、利用者に分かる環境名で表示する */
function environmentLabel(projectId: string | null) {
  if (projectId === 'kaigo-shift-saas') return '開発環境'
  if (projectId === 'kaigo-shift-saas-prod') return '本番環境'
  return projectId ?? '不明'
}

function yyyymmdd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 施設データの引っ越し（書き出し・読み込み）。開発環境で作り込んだ施設を本番環境へ丸ごと移すためのもの。
 * docs/remaining-work-design.md §12 参照。
 */
export default function FacilityTransferSection({
  facilities,
  onImported,
}: {
  facilities: FacilityWithId[]
  onImported: () => Promise<void>
}) {
  const { user } = useAuth()
  const { appUser, refreshFacilities } = useFacility()

  const [exportId, setExportId] = useState('')
  const [exporting, setExporting] = useState(false)

  const [file, setFile] = useState<FacilityTransferFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [target, setTarget] = useState<ImportTarget | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentEnv = environmentLabel(firebaseStatus.projectId)
  const selectedExportId = exportId || facilities[0]?.id || ''

  async function handleExport() {
    const facility = facilities.find((f) => f.id === selectedExportId)
    if (!facility) return
    setExporting(true)
    setError(null)
    try {
      const data = await exportFacilityData(facility.id)
      downloadJson(data, `施設データ_${facility.name}_${yyyymmdd(new Date())}.json`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        msg.includes('permission')
          ? `「${facility.name}」に所属していないため書き出せません。下の「管理者ユーザー」で自分の所属施設に加えてから書き出してください。`
          : msg,
      )
    } finally {
      setExporting(false)
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // 同じファイルを選び直しても反応するように
    setFile(null)
    setTarget(null)
    setResult(null)
    setError(null)
    if (!f) return
    setFileName(f.name)
    try {
      const parsed = parseTransferFile(await f.text())
      setTarget(await inspectImportTarget(parsed.facility.id))
      setFile(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleImport() {
    if (!file || !user || !appUser || !target) return
    const lines = [`「${file.facility.name}」を${currentEnv}に読み込みます。`]
    if (target.exists) {
      lines.push(
        `この環境の「${target.currentName ?? file.facility.name}」は、ファイルの内容で置き換わります。`,
        'ファイルに無い職員・条件・勤務表などは削除されます。',
      )
    }
    lines.push('', 'よろしいですか？')
    if (!window.confirm(lines.join('\n'))) return

    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const r = await importFacilityData(file, { uid: user.uid, user: appUser }, setProgress)
      await refreshFacilities()
      await onImported()
      setResult(
        `「${file.facility.name}」の読み込みが完了しました（書き込み ${r.written}件・削除 ${r.deleted}件）。` +
          '「← シフト表に戻る」から施設を選んで中身を確認してください。',
      )
      setFile(null)
      setTarget(null)
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : String(e)}（途中で止まった場合も、同じファイルをもう一度読み込めば正しい状態になります）`,
      )
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }

  const counts = file ? countDocs(file) : null
  const sameEnvironment = !!file && file.sourceProjectId === firebaseStatus.projectId

  return (
    <section className="card">
      <h2>📦 施設データの引っ越し</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        施設のデータ（職員・勤務パターン・条件・相性・設定・勤務表・希望休など）を丸ごと1つのファイルに書き出し、
        別の環境で読み込みます。開発環境から本番環境へ移すときや、バックアップに使います。
        今は<strong>{currentEnv}</strong>を開いています。
      </p>
      {error && <p className="warn">{error}</p>}
      {result && <p className="orgadmin-invite-success">{result}</p>}

      <h3>書き出す</h3>
      {facilities.length === 0 ? (
        <p className="muted">書き出せる施設がありません。</p>
      ) : (
        <div className="field-row">
          <select value={selectedExportId} onChange={(e) => setExportId(e.target.value)}>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void handleExport()} disabled={exporting || !selectedExportId}>
            {exporting ? '書き出し中…' : '書き出す'}
          </button>
        </div>
      )}

      <h3>読み込む</h3>
      <div className="orgadmin-invite-card">
        <div className="form-stack" style={{ gap: 12 }}>
          <label>
            書き出したファイル（.json）を選ぶ
            <input type="file" accept=".json,application/json" onChange={(e) => void handleFileChange(e)} disabled={importing} />
          </label>

          {file && counts && target && (
            <>
              <div>
                <div>
                  <strong>{file.facility.name}</strong>
                  <span className="muted">
                    {'　'}
                    {environmentLabel(file.sourceProjectId)}から書き出し
                    {file.exportedAt && `（${new Date(file.exportedAt).toLocaleString('ja-JP')}）`}
                    {'　'}
                    {fileName}
                  </span>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {TRANSFER_COLLECTIONS.map((name) => `${TRANSFER_COLLECTION_LABELS[name]} ${counts[name]}件`).join('・')}
                </div>
              </div>

              {sameEnvironment && (
                <p className="warn">
                  このファイルは今と同じ{currentEnv}から書き出したものです。読み込むと、この環境の「{file.facility.name}」が
                  ファイルを書き出した時点の内容に戻ります。
                </p>
              )}
              {target.exists ? (
                <p className="warn">
                  この環境にはすでに「{target.currentName ?? file.facility.name}」があります。読み込むと、その施設のデータは
                  ファイルの内容で置き換わります（ファイルに無い職員・条件・勤務表などは削除されます）。
                </p>
              ) : (
                <p className="muted">この環境に新しい施設として作成し、あなたの所属施設に追加します。</p>
              )}

              <button
                type="button"
                className="primary"
                onClick={() => void handleImport()}
                disabled={importing}
                style={{ alignSelf: 'flex-start' }}
              >
                {importing ? '読み込み中…' : 'この内容で読み込む'}
              </button>
              {progress && <p className="muted">{progress}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
