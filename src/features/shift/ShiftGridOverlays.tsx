import {
  ScheduleLockedError,
  fillEmptyAssignments,
  saveMonthlyMaxDaysOverride,
  saveTimeproExportSettings,
} from '../../lib/firestore'
import { formatMonthDayWeekday } from '../../lib/dateUtils'
import SubmissionExportModal from '../submission/SubmissionExportModal'
import CellPicker from './CellPicker'
import EventPicker from './EventPicker'
import MonthlyLimitsModal from './MonthlyLimitsModal'
import BulkFillModal from './BulkFillModal'
import EditLockModal from './EditLockModal'
import TimeproModal from '../timepro/TimeproModal'
import type { ShiftGrid } from './useShiftGrid'

/**
 * マスの選択パネル・行事の入力・編集ロック・月の上限・まとめて入力・出力のモーダル。
 * 改善指示書 D7 で ShiftGridPage.tsx から分けた（remaining-work-design.md §26）。
 */
export default function ShiftGridOverlays({ g }: { g: ShiftGrid }) {
  const {
    user,
    selectedFacilityId,
    facilities,
    shiftPatterns,
    employmentTypes,
    isAdmin,
    selectedFacility,
    yearMonth,
    schedule,
    staffList,
    setUnlockedKey,
    editLockModal,
    setEditLockModal,
    wishes,
    picker,
    setPicker,
    eventPicker,
    setEventPicker,
    showLimitsModal,
    setShowLimitsModal,
    showBulkFill,
    setShowBulkFill,
    setBulkMsg,
    showTimeproModal,
    setShowTimeproModal,
    showSubmissionModal,
    setShowSubmissionModal,
    timeproPatternMap,
    setTimeproPatternMap,
    days,
    load,
    monthKey,
    tempUnlocked,
    handleWriteError,
    handleLock,
    previewCandidate,
    effectiveAssignments,
    workPatterns,
    optionsFor,
    handleAssign,
    handleAssignSecondary,
    handleToggleLock,
    handleSetEvent,
  } = g
  return (
    <>
      {picker &&
        !previewCandidate &&
        (() => {
          const pickerStaff = staffList.find((s) => s.id === picker.staffId)
          if (!pickerStaff) return null

          if (picker.kind === 'secondary') {
            return (
              <CellPicker
                anchorRect={picker.rect}
                staffName={`${pickerStaff.name}（生活相談員）`}
                dateLabel={formatMonthDayWeekday(yearMonth, picker.day)}
                options={workPatterns}
                current={schedule?.secondaryAssignments?.[picker.staffId]?.[String(picker.day)] ?? ''}
                locked={false}
                showLock={false}
                onPick={(patternId) => {
                  void handleAssignSecondary(picker.staffId, picker.day, patternId)
                  setPicker(null)
                }}
                onClear={() => {
                  void handleAssignSecondary(picker.staffId, picker.day, '')
                  setPicker(null)
                }}
                onToggleLock={() => {}}
                onClose={() => setPicker(null)}
              />
            )
          }

          const locked = schedule?.locks?.[picker.staffId]?.[String(picker.day)] ?? false
          return (
            <CellPicker
              anchorRect={picker.rect}
              staffName={pickerStaff.name}
              dateLabel={formatMonthDayWeekday(yearMonth, picker.day)}
              options={optionsFor(pickerStaff)}
              current={schedule?.assignments?.[picker.staffId]?.[String(picker.day)] ?? ''}
              locked={locked}
              onPick={(patternId) => {
                void handleAssign(picker.staffId, picker.day, patternId)
                setPicker(null)
              }}
              onClear={() => {
                void handleAssign(picker.staffId, picker.day, '')
                setPicker(null)
              }}
              onToggleLock={() => {
                void handleToggleLock(picker.staffId, picker.day, locked)
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
          )
        })()}

      {editLockModal && (
        <EditLockModal
          mode={editLockModal}
          yearMonth={yearMonth}
          lock={schedule?.editLock}
          onSubmit={async (password) => {
            if (editLockModal === 'lock') await handleLock(password)
            else {
              setUnlockedKey(monthKey)
              setEditLockModal(null)
            }
          }}
          onClose={() => setEditLockModal(null)}
        />
      )}

      {eventPicker && (
        <EventPicker
          anchorRect={eventPicker.rect}
          dateLabel={formatMonthDayWeekday(yearMonth, eventPicker.day)}
          current={schedule?.events?.[String(eventPicker.day)] ?? ''}
          onSave={(text) => void handleSetEvent(eventPicker.day, text)}
          onClose={() => setEventPicker(null)}
        />
      )}

      {showLimitsModal && (
        <MonthlyLimitsModal
          yearMonth={yearMonth}
          daysInMonth={days}
          staffList={staffList}
          employmentTypes={employmentTypes}
          initialOverride={schedule?.monthlyMaxDaysOverride ?? {}}
          onSave={async (override) => {
            if (!selectedFacilityId || !user) return
            try {
              await saveMonthlyMaxDaysOverride(selectedFacilityId, yearMonth, days, override, user.uid, tempUnlocked)
            } catch (e) {
              if (!(e instanceof ScheduleLockedError)) throw e
              // ほかの画面でロックされた。モーダルを閉じ、読み込み直して案内する
              setShowLimitsModal(false)
              await handleWriteError(e)
              return
            }
            await load()
          }}
          onClose={() => setShowLimitsModal(false)}
        />
      )}

      {showBulkFill && (
        <BulkFillModal
          yearMonth={yearMonth}
          daysInMonth={days}
          staffList={staffList}
          shiftPatterns={shiftPatterns}
          assignments={schedule?.assignments}
          locks={schedule?.locks}
          wishes={wishes}
          optionsFor={optionsFor}
          onRun={async (cells, patternId) => {
            if (!selectedFacilityId || !user) return 0
            let written: number
            try {
              written = await fillEmptyAssignments(selectedFacilityId, yearMonth, days, cells, patternId, user.uid, tempUnlocked)
            } catch (e) {
              if (!(e instanceof ScheduleLockedError)) throw e
              // ほかの画面でロックされた。何も書いていない。閉じて読み込み直し、案内する
              setShowBulkFill(false)
              await handleWriteError(e)
              return 0
            }
            setShowBulkFill(false)
            await load()
            const code = shiftPatterns.find((p) => p.id === patternId)?.code ?? ''
            setBulkMsg(
              written === cells.length
                ? `まとめて入力: ${written}マスに「${code}」を入れました`
                : `まとめて入力: ${written}マスに「${code}」を入れました（確認のあとにほかの人が入力・ロックした${cells.length - written}マスは変えていません）`,
            )
            return written
          }}
          onClose={() => setShowBulkFill(false)}
        />
      )}

      {showSubmissionModal && selectedFacility && (
        <SubmissionExportModal
          facilities={[
            selectedFacility,
            ...facilities.filter(
              (f) => f.id !== selectedFacility.id && !!selectedFacility.officeName && f.officeName === selectedFacility.officeName,
            ),
          ]}
          yearMonth={yearMonth}
          isAdmin={isAdmin}
          onClose={() => setShowSubmissionModal(false)}
        />
      )}

      {showTimeproModal && (
        <TimeproModal
          yearMonth={yearMonth}
          daysInMonth={days}
          staffList={staffList}
          shiftPatterns={shiftPatterns}
          assignments={effectiveAssignments}
          savedPatternMap={timeproPatternMap}
          isAdmin={isAdmin}
          onSave={async (patternMap) => {
            if (!selectedFacilityId) return
            await saveTimeproExportSettings(selectedFacilityId, { patternMap })
            setTimeproPatternMap(patternMap)
          }}
          onClose={() => setShowTimeproModal(false)}
        />
      )}

    </>
  )
}
