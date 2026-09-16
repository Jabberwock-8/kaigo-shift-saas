import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'
import { createFacility, updateOrgUser } from '../lib/firestore'

/**
 * 所属施設をタブで切り替えるバー。同じ法人内に複数の勤務作成単位（例: 第二男子棟／第二女子棟）
 * がある施設向け。admin ならタブの末尾に「＋」で新しい施設をその場で作成でき、
 * 作成後は自動的に自分の所属施設に追加され、そのままそのタブに切り替わる。
 */
export default function FacilityTabs() {
  const { user } = useAuth()
  const { appUser, facilities, selectedFacilityId, selectFacility, refreshFacilities } = useFacility()
  const isAdmin = appUser?.role === 'admin'

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (facilities.length <= 1 && !isAdmin) return null

  async function handleCreate() {
    if (!appUser?.organizationId || !user || !name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const newId = await createFacility(appUser.organizationId, {
        name: name.trim(),
        shortName: shortName.trim() || undefined,
      })
      const nextIds = [...new Set([...(appUser.facilityIds ?? []), newId])]
      await updateOrgUser(user.uid, { facilityIds: nextIds })
      await refreshFacilities()
      selectFacility(newId)
      setAdding(false)
      setName('')
      setShortName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="facility-tabs no-print">
      {facilities.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`facility-tab${f.id === selectedFacilityId ? ' active' : ''}`}
          onClick={() => selectFacility(f.id)}
        >
          {f.shortName ?? f.name}
        </button>
      ))}

      {isAdmin && !adding && (
        <button type="button" className="facility-tab add" onClick={() => setAdding(true)} title="施設を追加">
          ＋
        </button>
      )}

      {isAdmin && adding && (
        <span className="facility-tab-add-form">
          <input
            autoFocus
            placeholder="施設名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: 130 }}
          />
          <input
            placeholder="短縮名（任意）"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            style={{ width: 90 }}
          />
          <button type="button" onClick={() => void handleCreate()} disabled={saving || !name.trim()}>
            {saving ? '作成中…' : '保存'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setAdding(false)
              setError(null)
            }}
          >
            キャンセル
          </button>
        </span>
      )}

      {error && (
        <span className="warn" style={{ marginLeft: 8 }}>
          {error}
        </span>
      )}
    </div>
  )
}
