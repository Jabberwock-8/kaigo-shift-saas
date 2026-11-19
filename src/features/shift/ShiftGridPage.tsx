import { useShiftGrid } from './useShiftGrid'
import ShiftToolbar from './ShiftToolbar'
import ShiftStatusArea from './ShiftStatusArea'
import ShiftGridTable from './ShiftGridTable'
import ShiftGridOverlays from './ShiftGridOverlays'
import PrintableShiftGrid from './PrintableShiftGrid'

/**
 * シフト表の画面。状態と処理は useShiftGrid、表示は4つの部品に分けてある（改善指示書 D7・remaining-work-design.md §26）。
 */
export default function ShiftGridPage() {
  const g = useShiftGrid()
  if (!g.selectedFacilityId) return null
  const {
    shiftPatterns,
    facilityName,
    yearMonth,
    schedule,
    staffList,
    rules,
    currentWeek,
    isWeek,
  } = g

  return (
    <section className="card">
      <ShiftToolbar g={g} />
      <ShiftStatusArea g={g} />
      <ShiftGridTable g={g} />
      <ShiftGridOverlays g={g} />

      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <PrintableShiftGrid
          facilityName={facilityName}
          yearMonth={yearMonth}
          days={isWeek ? currentWeek : undefined}
          staffList={staffList}
          schedule={schedule}
          shiftPatterns={shiftPatterns}
          rules={rules}
        />
      )}
    </section>
  )
}
