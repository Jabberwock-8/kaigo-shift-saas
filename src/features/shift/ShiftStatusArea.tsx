import {
  Lock,
  LockOpen,
  PenLine,
  Save,
  TriangleAlert,
} from 'lucide-react'
import NightTargetPanel from './NightTargetPanel'
import CandidatesPanel from '../generate/CandidatesPanel'
import type { ShiftGrid } from './useShiftGrid'

/**
 * 表の上の案内（編集ロック・生成の結果と案・プレビュー・夜勤回数・違反の件数と一覧・読み込み中）。
 * 改善指示書 D7 で ShiftGridPage.tsx から分けた（remaining-work-design.md §26）。
 */
export default function ShiftStatusArea({ g }: { g: ShiftGrid }) {
  const {
    shiftPatterns,
    mastersLoading,
    isAdmin,
    staffList,
    setUnlockedKey,
    loading,
    error,
    storedCandidates,
    candidates,
    setCandidates,
    previewId,
    setPreviewId,
    generating,
    genNotice,
    adoptingId,
    genError,
    backupMsg,
    bulkMsg,
    showViolationList,
    setShowViolationList,
    days,
    editLocked,
    tempUnlocked,
    canEditMonth,
    handleRemoveLock,
    previewCandidate,
    effectiveAssignments,
    checkResult,
    handleAdopt,
  } = g
  return (
    <>
      {editLocked && (
        <p className={`no-print edit-lock-banner${tempUnlocked ? ' unlocked' : ''}`}>
          {tempUnlocked ? (
            <>
              <LockOpen className="ico" size={16} aria-hidden="true" />
              一時解除中です。ほかの月・画面に移るか、再読み込みするとロックに戻ります。
              <button type="button" className="link-btn" onClick={() => setUnlockedKey(null)}>
                ロックに戻す
              </button>
              <button type="button" className="link-btn" onClick={() => void handleRemoveLock()}>
                ロックを外す
              </button>
            </>
          ) : (
            <>
              <Lock className="ico" size={16} aria-hidden="true" />
              この月の勤務表はロックされています（見る・印刷・出力はできます）。{isAdmin && '変更するには「一時解除」を押してください。'}</>
          )}
        </p>
      )}
      {genError && <p className="warn no-print">{genError}</p>}
      {genNotice && <p className="muted no-print">{genNotice}</p>}
      {backupMsg && (
        <p className="muted no-print">
          <Save className="ico" size={16} aria-hidden="true" />
          {backupMsg}
        </p>
      )}
      {bulkMsg && (
        <p className="muted no-print">
          <PenLine className="ico" size={16} aria-hidden="true" />
          {bulkMsg}
        </p>
      )}

      {canEditMonth && !candidates && storedCandidates.length > 0 && (
        <p className="no-print" style={{ marginBottom: 10 }}>
          <button type="button" className="link-btn" onClick={() => setCandidates(storedCandidates)}>
            前回の生成結果を表示（{storedCandidates.length}案）
          </button>
        </p>
      )}

      {candidates && canEditMonth && (
        <CandidatesPanel
          candidates={candidates}
          previewId={previewId}
          adoptingId={adoptingId}
          generating={generating}
          onPreview={(id) => setPreviewId((cur) => (cur === id ? null : id))}
          onAdopt={(c) => void handleAdopt(c)}
        />
      )}

      {previewCandidate && canEditMonth && (
        <p className="no-print preview-banner">
          プレビュー中: {previewCandidate.label}（未確定）
          <button type="button" className="link-btn" onClick={() => void handleAdopt(previewCandidate)}>
            この案を採択
          </button>
          <button type="button" className="link-btn" onClick={() => setPreviewId(null)}>
            閉じる
          </button>
        </p>
      )}

      {!loading && (
        <NightTargetPanel
          staffList={staffList}
          shiftPatterns={shiftPatterns}
          assignments={effectiveAssignments}
          daysInMonth={days}
        />
      )}

      {!loading && !mastersLoading && (checkResult.hardCount > 0 || checkResult.softCount > 0) && (
        <div className="no-print" style={{ marginBottom: 10 }}>
          <p style={{ marginBottom: showViolationList ? 8 : 0 }}>
            {checkResult.hardCount > 0 && (
              <span className="warn" style={{ marginRight: 12 }}>
                <TriangleAlert className="ico" size={16} aria-hidden="true" />
                必須条件の違反 {checkResult.hardCount}件
              </span>
            )}
            {checkResult.softCount > 0 && (
              <span className="muted" style={{ marginRight: 12 }}>
                推奨条件の未達 {checkResult.softCount}件
              </span>
            )}
            <button type="button" className="link-btn" onClick={() => setShowViolationList((v) => !v)}>
              {showViolationList ? '一覧を閉じる' : '違反の一覧を表示'}
            </button>
          </p>
          {showViolationList && (
            <div className="violation-list">
              {checkResult.hard.length > 0 && (
                <>
                  <h4 className="warn">必須条件の違反</h4>
                  <ul>
                    {checkResult.hard.map((msg, i) => (
                      <li key={`hard-${i}`}>{msg}</li>
                    ))}
                  </ul>
                </>
              )}
              {checkResult.soft.length > 0 && (
                <>
                  <h4 className="muted">推奨条件の未達</h4>
                  <ul>
                    {checkResult.soft.map((msg, i) => (
                      <li key={`soft-${i}`}>{msg}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {(loading || mastersLoading) && <p className="muted no-print">読み込み中…</p>}
      {error && <p className="warn no-print">{error}</p>}
      {!loading && staffList.length === 0 && (
        <p className="muted no-print">有効な職員が登録されていません。</p>
      )}
      {!loading && shiftPatterns.length === 0 && (
        <p className="warn no-print">
          勤務パターンが未登録です。先に「勤務パターン」タブで登録してください。
        </p>
      )}

    </>
  )
}
