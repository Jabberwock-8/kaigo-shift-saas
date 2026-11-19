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

      <p className="muted no-print" style={{ marginTop: 10 }}>
        セルをクリックすると勤務パターンを選択できます。<strong>セルを右クリックするとロックを切り替えられます</strong>
        （パネル内の「ロック切替」でも同じ操作ができます）。ロックは自動生成でこのセルを固定する目印です（右上に灰色の点が付きます）。
        「!」は必須条件・相性・勤務条件などの違反（マウスを乗せると詳細）、金の枠は希望休が守れている日、赤の枠は希望休なのに勤務が入っている日です。
      </p>

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
