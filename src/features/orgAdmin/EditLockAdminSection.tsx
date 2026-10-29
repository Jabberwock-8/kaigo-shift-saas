import { useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { formatYearMonthLabel } from '../../lib/dateUtils'
import { clearScheduleEditLock, listEditLockedMonths } from '../../lib/firestore'

/**
 * 勤務表の編集ロックの強制解除（パスワードを忘れたとき用）。remaining-work-design.md §17。
 * 勤務表の書き込みはその施設の管理者に限られる（firestore.rules）ため、対象は自分の所属施設だけ。
 */
export default function EditLockAdminSection() {
  const { facilities } = useFacility()
  const [locked, setLocked] = useState<{ facilityId: string; facilityName: string; yearMonth: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setBusy(true)
    setError(null)
    try {
      const rows = await Promise.all(
        facilities.map(async (f) =>
          (await listEditLockedMonths(f.id)).map((yearMonth) => ({ facilityId: f.id, facilityName: f.name, yearMonth })),
        ),
      )
      setLocked(rows.flat())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlock(facilityId: string, facilityName: string, yearMonth: string) {
    if (!confirm(`${facilityName}の${formatYearMonthLabel(yearMonth)}の勤務表のロックを、パスワードなしで解除します。よろしいですか？`)) return
    setBusy(true)
    setError(null)
    try {
      await clearScheduleEditLock(facilityId, yearMonth)
      setLocked((cur) => cur?.filter((r) => !(r.facilityId === facilityId && r.yearMonth === yearMonth)) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>🔒 勤務表のロック解除</h2>
      <p className="muted">
        シフト表でかけたロックのパスワードを忘れたときに、ここから解除できます。対象は、あなたが所属している施設だけです。
      </p>
      <button type="button" onClick={() => void load()} disabled={busy}>
        {locked ? '再読み込み' : 'ロック中の勤務表を表示'}
      </button>
      {error && <p className="warn">{error}</p>}
      {locked && locked.length === 0 && <p className="muted">ロック中の勤務表はありません。</p>}
      {locked && locked.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>施設</th>
              <th>月</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {locked.map((r) => (
              <tr key={`${r.facilityId}/${r.yearMonth}`}>
                <td>{r.facilityName}</td>
                <td>{formatYearMonthLabel(r.yearMonth)}</td>
                <td>
                  <button type="button" onClick={() => void handleUnlock(r.facilityId, r.facilityName, r.yearMonth)} disabled={busy}>
                    🔓 解除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
