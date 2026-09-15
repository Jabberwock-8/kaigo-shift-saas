import { useEffect, useRef, useState } from 'react'

interface Props {
  anchorRect: DOMRect
  dateLabel: string
  current: string
  onSave: (text: string) => void
  onClose: () => void
}

/**
 * 行事セルをクリックしたときに出る、テキスト入力用のミニパネル（CellPickerと同じ position:fixed 方式）。
 */
export default function EventPicker({ anchorRect, dateLabel, current, onSave, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(current)

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

  const width = 240
  const top = anchorRect.bottom + 4
  const left = Math.min(anchorRect.left, window.innerWidth - width - 8)

  return (
    <div className="cell-picker no-print" ref={ref} style={{ top, left, width }}>
      <div className="cell-picker-head">{dateLabel}・行事</div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例: 敬老会"
        style={{ width: '100%', marginBottom: 10 }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(text)
            onClose()
          }
        }}
      />
      <div className="cell-picker-actions">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onSave('')
            onClose()
          }}
        >
          クリア
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            onSave(text)
            onClose()
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}
