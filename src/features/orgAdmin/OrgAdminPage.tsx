import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import {
  createFacility,
  fetchOrganizationFacilities,
  fetchOrganizationUsers,
  updateFacility,
  updateOrgUser,
} from '../../lib/firestore'
import type { AppUser, Facility } from '../../types/models'
import FacilityMultiSelect from './FacilityMultiSelect'
import FacilityTransferSection from './FacilityTransferSection'
import { inviteAdminUser } from './inviteAdmin'

type FacilityWithId = Facility & { id: string }
type UserWithId = AppUser & { id: string }

/** 施設カード用のシンプルな線画アイコン（絵文字より落ち着いた見た目にするため自作） */
function FacilityIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="12" height="17" rx="2" />
      <rect x="15.5" y="10.5" width="5" height="10" rx="1.5" />
      <rect x="6.3" y="7" width="2.2" height="2.2" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="10.5" y="7" width="2.2" height="2.2" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="6.3" y="11.3" width="2.2" height="2.2" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="10.5" y="11.3" width="2.2" height="2.2" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="7" y="16" width="3" height="4.5" rx="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * 施設・ユーザー管理（横展開用）。role='admin'のみアクセス可（firestore.rules参照）。
 * v1は施設の新規作成と、管理者アカウントの招待のみ（職員本人ログインは将来フェーズ）。
 */
export default function OrgAdminPage() {
  const { appUser, loading: facilityLoading } = useFacility()

  const [facilities, setFacilities] = useState<FacilityWithId[]>([])
  const [users, setUsers] = useState<UserWithId[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newFacilityName, setNewFacilityName] = useState('')
  const [newFacilityShortName, setNewFacilityShortName] = useState('')
  const [creatingFacility, setCreatingFacility] = useState(false)

  const [editingFacilityId, setEditingFacilityId] = useState<string | null>(null)
  const [editFacilityName, setEditFacilityName] = useState('')
  const [editFacilityShortName, setEditFacilityShortName] = useState('')
  const [savingFacilityId, setSavingFacilityId] = useState<string | null>(null)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteDisplayName, setInviteDisplayName] = useState('')
  const [inviteFacilityIds, setInviteFacilityIds] = useState<string[]>([])
  const [invitePrimaryFacilityId, setInvitePrimaryFacilityId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)

  const [rowEdits, setRowEdits] = useState<Record<string, { facilityIds: string[]; primaryFacilityId: string }>>({})
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  const organizationId = appUser?.organizationId ?? null

  /**
   * showSpinner=false は画面を「読み込み中…」に切り替えずに一覧だけ更新する。
   * 施設データの読み込み直後に使う（切り替えると引っ越し欄が作り直され、完了メッセージが消えるため）
   */
  async function load(showSpinner = true) {
    if (!organizationId) return
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const [fl, ul] = await Promise.all([
        fetchOrganizationFacilities(organizationId),
        fetchOrganizationUsers(organizationId),
      ])
      setFacilities(fl)
      setUsers(ul)
      setRowEdits(
        Object.fromEntries(
          ul.map((u) => [u.id, { facilityIds: u.facilityIds ?? [], primaryFacilityId: u.primaryFacilityId ?? '' }]),
        ),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  if (facilityLoading) return <p className="muted">読み込み中…</p>
  if (!appUser) return null
  if (appUser.role !== 'admin') {
    return (
      <section className="card">
        <h2>施設・ユーザー管理</h2>
        <p className="warn">権限がありません（管理者のみ利用できます）。</p>
      </section>
    )
  }

  async function handleCreateFacility() {
    if (!organizationId || !newFacilityName.trim()) return
    setCreatingFacility(true)
    setError(null)
    try {
      await createFacility(organizationId, {
        name: newFacilityName.trim(),
        shortName: newFacilityShortName.trim() || undefined,
      })
      setNewFacilityName('')
      setNewFacilityShortName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreatingFacility(false)
    }
  }

  function startEditFacility(f: FacilityWithId) {
    setEditingFacilityId(f.id)
    setEditFacilityName(f.name)
    setEditFacilityShortName(f.shortName ?? '')
  }

  async function saveFacilityEdit(facilityId: string) {
    if (!editFacilityName.trim()) return
    setSavingFacilityId(facilityId)
    setError(null)
    try {
      await updateFacility(facilityId, {
        name: editFacilityName.trim(),
        shortName: editFacilityShortName.trim() || undefined,
      })
      setEditingFacilityId(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingFacilityId(null)
    }
  }

  function toggleInviteFacility(id: string, selected: boolean) {
    setInviteFacilityIds((cur) => {
      const next = selected ? [...cur, id] : cur.filter((x) => x !== id)
      if (!selected && invitePrimaryFacilityId === id) setInvitePrimaryFacilityId('')
      return next
    })
  }

  async function handleInvite() {
    if (!organizationId || !inviteEmail.trim() || inviteFacilityIds.length === 0) return
    setInviting(true)
    setError(null)
    setInviteMessage(null)
    try {
      await inviteAdminUser({
        email: inviteEmail.trim(),
        displayName: inviteDisplayName.trim() || undefined,
        organizationId,
        facilityIds: inviteFacilityIds,
        primaryFacilityId: invitePrimaryFacilityId || inviteFacilityIds[0],
      })
      setInviteMessage(
        `✅ ${inviteEmail} を招待しました。本人にパスワード再設定メールが届くので、リンクからパスワードを設定してもらってください。`,
      )
      setInviteEmail('')
      setInviteDisplayName('')
      setInviteFacilityIds([])
      setInvitePrimaryFacilityId('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setInviting(false)
    }
  }

  function updateRowEdit(uid: string, patch: Partial<{ facilityIds: string[]; primaryFacilityId: string }>) {
    setRowEdits((prev) => ({ ...prev, [uid]: { ...prev[uid], ...patch } }))
  }

  function toggleRowFacility(uid: string, facilityId: string, selected: boolean) {
    const cur = rowEdits[uid]?.facilityIds ?? []
    const next = selected ? [...cur, facilityId] : cur.filter((x) => x !== facilityId)
    const primary = rowEdits[uid]?.primaryFacilityId ?? ''
    updateRowEdit(uid, {
      facilityIds: next,
      primaryFacilityId: !selected && primary === facilityId ? '' : primary,
    })
  }

  async function saveUserRow(uid: string) {
    const edit = rowEdits[uid]
    if (!edit) return
    setSavingUserId(uid)
    setError(null)
    try {
      await updateOrgUser(uid, {
        facilityIds: edit.facilityIds,
        primaryFacilityId: edit.primaryFacilityId || null,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingUserId(null)
    }
  }

  const facilityById = new Map(facilities.map((f) => [f.id, f]))

  if (loading) return <p className="muted">読み込み中…</p>

  return (
    <>
      <section className="card">
        <h2>施設</h2>
        {error && <p className="warn">{error}</p>}

        {facilities.length === 0 ? (
          <p className="muted">まだ施設がありません。下のフォームから最初の施設を作成してください。</p>
        ) : (
          <div className="orgadmin-facility-grid">
            {facilities.map((f) =>
              editingFacilityId === f.id ? (
                <div key={f.id} className="orgadmin-facility-card editing">
                  <div className="orgadmin-facility-edit-fields">
                    <input
                      value={editFacilityName}
                      onChange={(e) => setEditFacilityName(e.target.value)}
                      placeholder="施設名"
                    />
                    <input
                      value={editFacilityShortName}
                      onChange={(e) => setEditFacilityShortName(e.target.value)}
                      placeholder="短縮名（任意）"
                    />
                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => void saveFacilityEdit(f.id)}
                        disabled={savingFacilityId === f.id || !editFacilityName.trim()}
                      >
                        {savingFacilityId === f.id ? '保存中…' : '保存'}
                      </button>
                      <button type="button" className="ghost" onClick={() => setEditingFacilityId(null)}>
                        キャンセル
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={f.id} className="orgadmin-facility-card">
                  <span className="orgadmin-facility-icon">
                    <FacilityIcon />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="orgadmin-facility-name">{f.name}</div>
                    {f.shortName && <span className="tag-chip">{f.shortName}</span>}
                  </div>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => startEditFacility(f)}
                    title="施設名を編集"
                  >
                    ✎
                  </button>
                </div>
              ),
            )}
          </div>
        )}

        <div className="orgadmin-add-box">
          <div className="field-row">
            <input
              placeholder="新しい施設名"
              value={newFacilityName}
              onChange={(e) => setNewFacilityName(e.target.value)}
            />
            <input
              placeholder="短縮名（任意）"
              value={newFacilityShortName}
              onChange={(e) => setNewFacilityShortName(e.target.value)}
              style={{ width: 140 }}
            />
            <button
              type="button"
              onClick={() => void handleCreateFacility()}
              disabled={creatingFacility || !newFacilityName.trim()}
            >
              {creatingFacility ? '作成中…' : '＋ 施設を追加'}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>👥 管理者ユーザー</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          職員本人のログインはまだ対応していません。ここで招待できるのは各施設を管理する管理者アカウントのみです。
        </p>

        <div className="orgadmin-user-list">
          {users.map((u) => {
            const edit = rowEdits[u.id] ?? { facilityIds: [], primaryFacilityId: '' }
            return (
              <div key={u.id} className="orgadmin-user-row">
                <div className="orgadmin-user-head">
                  <div>
                    <div className="orgadmin-user-email">{u.email}</div>
                    {u.displayName && <div className="muted">{u.displayName}</div>}
                  </div>
                  <button type="button" onClick={() => void saveUserRow(u.id)} disabled={savingUserId === u.id}>
                    {savingUserId === u.id ? '保存中…' : '保存'}
                  </button>
                </div>

                <FacilityMultiSelect
                  facilities={facilities}
                  selectedIds={edit.facilityIds}
                  primaryId={edit.primaryFacilityId}
                  onAdd={(id) => toggleRowFacility(u.id, id, true)}
                  onRemove={(id) => toggleRowFacility(u.id, id, false)}
                />

                {edit.facilityIds.length > 1 && (
                  <div className="orgadmin-primary-row">
                    主施設
                    <select
                      value={edit.primaryFacilityId}
                      onChange={(e) => updateRowEdit(u.id, { primaryFacilityId: e.target.value })}
                    >
                      <option value="">（未設定）</option>
                      {edit.facilityIds.map((id) => (
                        <option key={id} value={id}>
                          {facilityById.get(id)?.name ?? id}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <h3>管理者を招待</h3>
        {inviteMessage && <p className="orgadmin-invite-success">{inviteMessage}</p>}
        <div className="orgadmin-invite-card">
          <div className="form-stack" style={{ maxWidth: 420, gap: 12 }}>
            <label>
              メールアドレス
              <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </label>
            <label>
              表示名（任意）
              <input value={inviteDisplayName} onChange={(e) => setInviteDisplayName(e.target.value)} />
            </label>
            <label>
              所属施設
              <div style={{ marginTop: 6 }}>
                <FacilityMultiSelect
                  facilities={facilities}
                  selectedIds={inviteFacilityIds}
                  onAdd={(id) => toggleInviteFacility(id, true)}
                  onRemove={(id) => toggleInviteFacility(id, false)}
                />
              </div>
            </label>
            {inviteFacilityIds.length > 1 && (
              <label>
                主施設
                <select value={invitePrimaryFacilityId} onChange={(e) => setInvitePrimaryFacilityId(e.target.value)}>
                  <option value="">（未設定）</option>
                  {inviteFacilityIds.map((id) => (
                    <option key={id} value={id}>
                      {facilityById.get(id)?.name ?? id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="primary"
              onClick={() => void handleInvite()}
              disabled={inviting || !inviteEmail.trim() || inviteFacilityIds.length === 0}
              style={{ alignSelf: 'flex-start' }}
            >
              {inviting ? '招待中…' : 'この内容で招待する'}
            </button>
          </div>
        </div>
      </section>

      <FacilityTransferSection facilities={facilities} onImported={() => load(false)} />
    </>
  )
}
