import { useState, type ChangeEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import {
  deleteShiftPattern,
  fetchShiftRulesSettings,
  fetchStaffList,
  listEmploymentTypes,
  listRules,
  listShiftPatterns,
} from '../../lib/firestore'
import { findDuplicatePatternGroups, type DuplicateGroup } from './dedupe'
import { runLegacyImport, type LegacyBackup } from './legacyImport'

/**
 * 旧HTML版の「JSONエクスポート」バックアップから、勤務パターン・職員・条件ルール・相性・
 * 希望休・設定をまとめて取り込む一時的な移行ツール（P7 Excel取込の前倒し簡易版）。
 * 差分プレビューは持たないため、実行は1回だけを前提とする。
 */
export default function ImportLegacyPage() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId } = useFacility()
  const { shiftPatterns, refresh } = useMasters()
  const isAdmin = appUser?.role === 'admin'

  const [backup, setBackup] = useState<LegacyBackup | null>(null)
  const [fileName, setFileName] = useState('')
  const [removePlaceholder, setRemovePlaceholder] = useState(true)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null)
  const [checkingDup, setCheckingDup] = useState(false)
  const [cleaningDup, setCleaningDup] = useState(false)

  if (!selectedFacilityId) return null
  if (!isAdmin) {
    return (
      <section className="card">
        <p className="muted">この機能は管理者のみ使用できます。</p>
      </section>
    )
  }

  const placeholderPattern = shiftPatterns.find((p) => p.label === '日勤' && !p.isSystem)
  const nonFixedCount = backup?.shiftTypes.filter((s) => !s.fixed).length ?? 0
  const compatCount = backup?.compatibility?.filter((c) => c.level !== 'good').length ?? 0
  const wishCount = Object.values(backup?.wishes ?? {}).reduce((n, ds) => n + ds.length, 0)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setLog(null)
    setFileName(file.name)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as LegacyBackup
      if (!Array.isArray(parsed.staff) || !Array.isArray(parsed.shiftTypes)) {
        throw new Error('staff / shiftTypes を含むJSONファイル（旧アプリのJSONエクスポート）を選択してください。')
      }
      setBackup(parsed)
    } catch (err) {
      setBackup(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleRun() {
    if (!backup || !selectedFacilityId || !user) return
    if (!confirm('旧データを取り込みます。実行は1回だけにしてください。よろしいですか？')) return
    setRunning(true)
    setError(null)
    setLog(null)
    try {
      // 前回の実行が途中で失敗している可能性があるため、再開時の重複作成を避けるべく
      // キャッシュ済みの一覧ではなく、実行直前に最新の状態を取得し直す
      const [existingEmploymentTypes, existingShiftPatterns, existingStaff] = await Promise.all([
        listEmploymentTypes(selectedFacilityId),
        listShiftPatterns(selectedFacilityId),
        fetchStaffList(selectedFacilityId),
      ])
      const result = await runLegacyImport(backup, {
        facilityId: selectedFacilityId,
        uid: user.uid,
        existingEmploymentTypes,
        existingShiftPatterns,
        existingStaff,
        removePlaceholderPatternId:
          removePlaceholder && placeholderPattern
            ? (existingShiftPatterns.find((p) => p.id === placeholderPattern.id)?.id ?? null)
            : null,
      })
      setLog(result.log)
      setBackup(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  async function handleCheckDuplicates() {
    if (!selectedFacilityId) return
    setCheckingDup(true)
    setError(null)
    try {
      const [patterns, staff, rules, settings] = await Promise.all([
        listShiftPatterns(selectedFacilityId),
        fetchStaffList(selectedFacilityId),
        listRules(selectedFacilityId),
        fetchShiftRulesSettings(selectedFacilityId),
      ])
      setDupGroups(findDuplicatePatternGroups(patterns, staff, rules, settings))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCheckingDup(false)
    }
  }

  async function handleCleanDuplicates() {
    if (!selectedFacilityId || !dupGroups) return
    const total = dupGroups.reduce((n, g) => n + g.removeIds.length, 0)
    if (!confirm(`未使用の重複パターンを${total}件削除します。よろしいですか？`)) return
    setCleaningDup(true)
    setError(null)
    try {
      for (const g of dupGroups) {
        for (const id of g.removeIds) {
          await deleteShiftPattern(selectedFacilityId, id)
        }
      }
      setDupGroups(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCleaningDup(false)
    }
  }

  return (
    <section className="card">
      <h2>旧データの取り込み（一時的な機能）</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        旧アプリの「設定」→「JSONエクスポート」で書き出したバックアップファイルから、勤務パターン・職員・条件ルール・
        相性・希望休・設定をまとめて登録します。シフト実績（過去の月間シフト表）は取り込みません。
        <strong>実行は1回だけにしてください</strong>（再実行すると条件ルールなどが重複する場合があります）。
      </p>

      <div className="form-stack">
        <label>
          バックアップファイル（.json）
          <input type="file" accept="application/json,.json" onChange={(e) => void handleFile(e)} />
        </label>
      </div>

      {backup && (
        <div className="card inner" style={{ marginTop: 14 }}>
          <h3>取り込み内容の確認（{fileName}）</h3>
          <ul>
            <li>勤務パターン: {nonFixedCount}件（公休・有給は既存の勤務パターンと紐付けます）</li>
            <li>職員: {backup.staff.length}名</li>
            <li>条件ルール: {(backup.rules ?? []).length}件</li>
            <li>相性: {compatCount}件</li>
            <li>希望休: {wishCount}件</li>
          </ul>
          {placeholderPattern && (
            <label className="row">
              <input
                type="checkbox"
                checked={removePlaceholder}
                onChange={(e) => setRemovePlaceholder(e.target.checked)}
              />
              仮登録の「{placeholderPattern.label}」（{placeholderPattern.code}）を削除する
            </label>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" onClick={() => void handleRun()} disabled={running}>
              {running ? '取り込み中…' : 'この内容で取り込む'}
            </button>
          </div>
        </div>
      )}

      <div className="card inner" style={{ marginTop: 14 }}>
        <h3>重複した勤務パターンの整理</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          取り込みが途中で失敗し再実行した場合など、同じ記号の勤務パターンが2件以上できてしまうことがあります。
          職員の勤務可能パターン・条件ルール・設定のどこからも使われていない方だけを検出して削除します。
        </p>
        <button type="button" onClick={() => void handleCheckDuplicates()} disabled={checkingDup}>
          {checkingDup ? '確認中…' : '重複をチェック'}
        </button>

        {dupGroups && dupGroups.length === 0 && <p className="ok" style={{ marginTop: 10 }}>重複はありませんでした。</p>}
        {dupGroups && dupGroups.length > 0 && (
          <>
            <ul style={{ marginTop: 10 }}>
              {dupGroups.map((g) => (
                <li key={g.code}>
                  {g.code}（{g.label}）: {g.removeIds.length}件を削除予定
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => void handleCleanDuplicates()} disabled={cleaningDup}>
              {cleaningDup ? '削除中…' : '未使用の重複を削除する'}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="warn" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}

      {log && (
        <div className="card inner" style={{ marginTop: 14 }}>
          <h3>結果</h3>
          <ul>
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 8 }}>
            「勤務パターン」画面で各パターンの「種別」（公休・夜勤明けなど）が正しく設定されているか確認してください。
          </p>
        </div>
      )}
    </section>
  )
}
