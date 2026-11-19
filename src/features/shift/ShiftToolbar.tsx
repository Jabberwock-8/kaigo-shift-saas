import {
  CalendarCog,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Ellipsis,
  FileSpreadsheet,
  FileText,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  PenLine,
  Printer,
  Upload,
  Zap,
} from 'lucide-react'
import {
  currentYearMonth,
  formatMonthDayWeekday,
  formatYearMonthLabel,
  shiftYearMonth,
  weekIndexOfToday,
} from '../../lib/dateUtils'
import type { ShiftGrid } from './useShiftGrid'

/**
 * シフト表の見出し・ツールバー（月の切り替え・表示・ロック・生成・出力・その他）と週表示の切り替え。
 * 改善指示書 D7 で ShiftGridPage.tsx から分けた（remaining-work-design.md §26）。
 */
export default function ShiftToolbar({ g }: { g: ShiftGrid }) {
  const {
    isAdmin,
    yearMonth,
    schedule,
    staffList,
    setUnlockedKey,
    setEditLockModal,
    setPicker,
    generating,
    genProgress,
    genAbortRef,
    setShowLimitsModal,
    setShowBulkFill,
    setBulkMsg,
    setShowTimeproModal,
    setShowSubmissionModal,
    setViewMode,
    weekIndex,
    setWeekIndex,
    fitToScreen,
    setFitToScreen,
    openMenu,
    setOpenMenu,
    toolbarRef,
    weeks,
    currentWeek,
    isWeek,
    moveMonth,
    editLocked,
    tempUnlocked,
    canEditMonth,
    previewCandidate,
    handleGenerate,
    handleExportExcel,
    handleClearAllLocks,
  } = g
  return (
    <>
      <div className="page-header no-print">
        <h2>シフト表</h2>
        <div className="header-actions toolbar" ref={toolbarRef}>
          {/* 月の切り替えをひとまとまりに（改善指示書 D4） */}
          <div className="month-nav" role="group" aria-label="月の切り替え">
            <button
              type="button"
              onClick={() => moveMonth(shiftYearMonth(yearMonth, -1))}
              aria-label="前の月"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="month-nav-label">{formatYearMonthLabel(yearMonth)}</span>
            <button
              type="button"
              onClick={() => moveMonth(shiftYearMonth(yearMonth, 1))}
              aria-label="次の月"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => moveMonth(currentYearMonth())}
          >
            今月
          </button>
          <div className="view-toggle" role="group" aria-label="表示の切り替え">
            <button
              type="button"
              className={!isWeek ? 'active' : undefined}
              onClick={() => {
                setPicker(null)
                setViewMode('month')
              }}
            >
              月
            </button>
            <button
              type="button"
              className={isWeek ? 'active' : undefined}
              onClick={() => {
                setPicker(null)
                setViewMode('week')
                setWeekIndex(weekIndexOfToday(yearMonth))
              }}
            >
              週
            </button>
          </div>
          <button type="button" onClick={() => setFitToScreen((v) => !v)}>
            {fitToScreen ? <Minimize2 className="ico" size={16} aria-hidden="true" /> : <Maximize2 className="ico" size={16} aria-hidden="true" />}
            {fitToScreen ? '実寸に戻す' : '画面に収める'}
          </button>
          <span className="toolbar-spacer" aria-hidden="true" />
          {isAdmin && (
            <button
              type="button"
              className={editLocked && !tempUnlocked ? 'edit-lock-on' : undefined}
              onClick={() => {
                if (!editLocked) setEditLockModal('lock')
                else if (!tempUnlocked) setEditLockModal('unlock')
                else setUnlockedKey(null)
              }}
              title={
                !editLocked
                  ? 'この月の勤務表をパスワードでロックし、うっかり変更されないようにします'
                  : tempUnlocked
                    ? '一時解除をやめて、ロックに戻します'
                    : 'パスワードを入れると、一時的に変更できます'
              }
            >
              {!editLocked || tempUnlocked ? <Lock className="ico" size={16} aria-hidden="true" /> : <LockOpen className="ico" size={16} aria-hidden="true" />}
              {!editLocked ? 'ロック' : tempUnlocked ? 'ロックに戻す' : '一時解除'}
            </button>
          )}
          <div className="toolbar-menu-wrap">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'export'}
              onClick={() => setOpenMenu((m) => (m === 'export' ? null : 'export'))}
            >
              <Upload className="ico" size={16} aria-hidden="true" />
              出力
              <ChevronDown className="ico-after" size={14} aria-hidden="true" />
            </button>
            {openMenu === 'export' && (
              <div className="toolbar-menu no-print" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null)
                    window.print()
                  }}
                >
                  <Printer className="ico" size={16} aria-hidden="true" />
                  {isWeek ? 'この週を印刷' : '印刷'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null)
                    void handleExportExcel()
                  }}
                  disabled={staffList.length === 0 || !!previewCandidate}
                  title={previewCandidate ? 'プレビュー中は書き出せません。採択するか、プレビューを閉じてください' : undefined}
                >
                  <FileSpreadsheet className="ico" size={16} aria-hidden="true" />
                  Excelで出力
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null)
                    setShowSubmissionModal(true)
                  }}
                  disabled={staffList.length === 0}
                >
                  <FileText className="ico" size={16} aria-hidden="true" />
                  市の提出様式
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null)
                    setShowTimeproModal(true)
                  }}
                  disabled={staffList.length === 0}
                >
                  <ClipboardList className="ico" size={16} aria-hidden="true" />
                  TimePro貼付用
                </button>
              </div>
            )}
          </div>
          {isAdmin && (
            <div className="toolbar-menu-wrap">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'misc'}
                onClick={() => setOpenMenu((m) => (m === 'misc' ? null : 'misc'))}
              >
                <Ellipsis className="ico" size={16} aria-hidden="true" />
                その他
                <ChevronDown className="ico-after" size={14} aria-hidden="true" />
              </button>
              {openMenu === 'misc' && (
                <div className="toolbar-menu no-print" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      setShowLimitsModal(true)
                    }}
                    disabled={!canEditMonth}
                  >
                    <CalendarCog className="ico" size={16} aria-hidden="true" />
                    月の上限を調整
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      setBulkMsg(null)
                      setShowBulkFill(true)
                    }}
                    disabled={!canEditMonth || !!previewCandidate || staffList.length === 0}
                    title={previewCandidate ? 'プレビュー中は使えません。採択するか、プレビューを閉じてください' : undefined}
                  >
                    <PenLine className="ico" size={16} aria-hidden="true" />
                    まとめて入力
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null)
                      void handleClearAllLocks()
                    }}
                    disabled={!canEditMonth || Object.values(schedule?.locks ?? {}).every((byDay) => Object.keys(byDay).length === 0)}
                  >
                    <LockOpen className="ico" size={16} aria-hidden="true" />
                    ロックを全解除
                  </button>
                </div>
              )}
            </div>
          )}
          {/* パターン生成は右端の主ボタン（改善指示書 D4） */}
          {canEditMonth && (
            <>
              <button type="button" className="primary" onClick={() => void handleGenerate()} disabled={generating}>
                {!generating && <Zap className="ico" size={16} aria-hidden="true" />}
                {!generating
                  ? 'パターン生成'
                  : genProgress
                    ? `${genProgress.label} 作成中…（${genProgress.index + 1}/${genProgress.total}${genProgress.attempt > 1 ? `・${genProgress.attempt}回目` : ''}）`
                    : '準備中…'}
              </button>
              {generating && (
                <button type="button" className="ghost" onClick={() => genAbortRef.current?.abort('user')}>
                  中止
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {isWeek && (
        <div className="week-nav no-print">
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setWeekIndex((i) => Math.max(0, i - 1))
            }}
            disabled={weekIndex === 0}
          >
            <ChevronLeft className="ico" size={16} aria-hidden="true" />
            前の週
          </button>
          <strong>
            第{weekIndex + 1}週（{formatMonthDayWeekday(yearMonth, currentWeek[0])}〜
            {formatMonthDayWeekday(yearMonth, currentWeek.at(-1)!)}）
          </strong>
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setWeekIndex((i) => Math.min(weeks.length - 1, i + 1))
            }}
            disabled={weekIndex >= weeks.length - 1}
          >
            次の週
            <ChevronRight className="ico-after" size={16} aria-hidden="true" />
          </button>
        </div>
      )}

    </>
  )
}
