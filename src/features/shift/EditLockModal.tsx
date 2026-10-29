import { useState } from 'react'
import Modal from '../../components/Modal'
import { formatYearMonthLabel } from '../../lib/dateUtils'
import { EDIT_LOCK_MIN_LENGTH, verifyEditLockPassword } from '../../lib/editLock'

interface Props {
  mode: 'lock' | 'unlock'
  yearMonth: string
  /** unlock のとき、照合に使う保存済みの値 */
  lock?: { hash: string; salt: string }
  /** lock: 決めたパスワードで鍵をかける / unlock: 照合に成功したら呼ぶ */
  onSubmit: (password: string) => Promise<void>
  onClose: () => void
}

/** 勤務表の編集ロック（月ごと）をかける・一時解除するためのパスワード入力 */
export default function EditLockModal({ mode, yearMonth, lock, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const label = formatYearMonthLabel(yearMonth)

  async function handleSubmit() {
    setError(null)
    if (mode === 'lock') {
      if (password.length < EDIT_LOCK_MIN_LENGTH) return setError(`パスワードは${EDIT_LOCK_MIN_LENGTH}文字以上にしてください`)
      if (password !== confirmText) return setError('確認用のパスワードが一致しません')
    }
    setBusy(true)
    try {
      if (mode === 'unlock' && !(lock && (await verifyEditLockPassword(password, lock)))) {
        setError('パスワードが違います')
        return
      }
      await onSubmit(password)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={mode === 'lock' ? `${label}の勤務表をロック` : `${label}の勤務表を一時解除`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={() => void handleSubmit()} disabled={busy || !password}>
            {mode === 'lock' ? '🔒 ロックする' : '🔓 一時解除'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        {mode === 'lock' ? (
          <p className="muted">
            ロック中は、この月の勤務・兼務行・セルのロック・自動作成と採択・行事・月の上限調整を変更できなくなります。
            見る・印刷・各種の出力はできます。パスワードは自由に決めてください（{EDIT_LOCK_MIN_LENGTH}文字以上）。
            忘れたときは「施設・ユーザー管理」から解除できます。
          </p>
        ) : (
          <p className="muted">
            ロックをかけたときのパスワードを入れてください。一時解除は、ほかの月・画面に移るか、再読み込みするとロックに戻ります。
          </p>
        )}
        <label>
          パスワード
          <input type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mode === 'lock' && (
          <label>
            パスワード（確認）
            <input type="password" autoComplete="new-password" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </label>
        )}
        {error && <p className="warn">{error}</p>}
        {/* Enter で送信できるように */}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
