import { useEffect } from 'react'

interface Props {
  message: string
  onDone: () => void
}

/**
 * 画面下部に浮かぶ一時的な通知（コピー完了など、フォーム外の軽い確認向け）。
 * 「保存しました」のような操作結果はこれまで通り画面内のテキストで示す。
 */
export default function Toast({ message, onDone }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1800)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}
