import { useEffect, useRef } from 'react'
import type { ShiftPattern } from '../../types/models'

type PatternWithId = ShiftPattern & { id: string }

interface Props {
  anchorRect: DOMRect
  staffName: string
  dateLabel: string
  options: PatternWithId[]
  current: string
  locked: boolean
  /** 兼務行などロック機能が不要な場合にfalseを渡す（既定true） */
  showLock?: boolean
  onPick: (patternId: string) => void
  onClear: () => void
  onToggleLock: () => void
  onClose: () => void
}

/**
 * セルをクリックしたときに出る、勤務パターン選択用のミニパネル。
 * 旧HTML版の openCellPicker と同じ構成（氏名・日付の見出し／記号チップ／クリア・ロック切替）。
 * position:fixed で表示するため、シフト表の横スクロールに巻き込まれず常に見える位置に出る。
 */
export default function CellPicker({
  anchorRect,
  staffName,
  dateLabel,
  options,
  current,
  locked,
  showLock = true,
  onPick,
  onClear,
  onToggleLock,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const width = 260
  const top = anchorRect.bottom + 4
  const left = Math.min(anchorRect.left, window.innerWidth - width - 8)

  return (
    <div className="cell-picker no-print" ref={ref} style={{ top, left, width }}>
      <div className="cell-picker-head">
        {staffName}・{dateLabel}
        {locked && <span title="ロック中"> 🔒</span>}
      </div>
      <div className="cell-picker-chips">
        {options.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`chip${p.id === current ? ' selected' : ''}`}
            style={{ background: p.color ?? '#fff', color: p.textColor ?? '#22271F' }}
            onClick={() => onPick(p.id)}
          >
            {p.code}
          </button>
        ))}
      </div>
      <div className="cell-picker-actions">
        <button type="button" className="link-btn" onClick={onClear}>
          クリア
        </button>
        {showLock && (
          <button type="button" className="link-btn" onClick={onToggleLock}>
            ロック切替
          </button>
        )}
      </div>
    </div>
  )
}
