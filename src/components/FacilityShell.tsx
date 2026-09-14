import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'
import { MastersProvider } from '../context/MastersContext'
import StaffListPage from '../features/staff/StaffListPage'
import StaffFormPage from '../features/staff/StaffFormPage'
import ShiftPatternsPage from '../features/masters/ShiftPatternsPage'
import JobTypesPage from '../features/masters/JobTypesPage'
import EmploymentTypesPage from '../features/masters/EmploymentTypesPage'
import ShiftGridPage from '../features/shift/ShiftGridPage'
import WishesPage from '../features/wishes/WishesPage'
import CompatibilityPage from '../features/compatibility/CompatibilityPage'
import RulesPage from '../features/rules/RulesPage'
import SettingsPage from '../features/settings/SettingsPage'
import ImportLegacyPage from '../features/importLegacy/ImportLegacyPage'

const TABS = [
  { to: '/shift', label: 'シフト表', icon: '📅' },
  { to: '/wishes', label: '希望休', icon: '🙋' },
  { to: '/staff', label: '職員', icon: '👤' },
  { to: '/compatibility', label: '相性', icon: '🤝' },
  { to: '/rules', label: '条件', icon: '📋' },
  { to: '/shift-patterns', label: '勤務パターン', icon: '🕒' },
  { to: '/job-types', label: '職種', icon: '🏷️' },
  { to: '/employment-types', label: '雇用区分', icon: '📁' },
  { to: '/settings', label: '設定', icon: '⚙️' },
  { to: '/import-legacy', label: '旧データ取込', icon: '🗂️' },
]

export default function FacilityShell() {
  const { signOut } = useAuth()
  const { appUser, facilities, selectedFacilityId, selectFacility } = useFacility()
  const facility = facilities.find((f) => f.id === selectedFacilityId)

  if (!selectedFacilityId) return null

  return (
    <MastersProvider facilityId={selectedFacilityId}>
      <div className="app-layout">
        <aside className="sidebar no-print">
          <div className="sidebar-logo">
            介護
            <br />
            シフト
          </div>
          <nav className="sidebar-nav">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
              >
                <span className="nico">{t.icon}</span>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="main-area">
          <div className="page-header no-print">
            <div>
              <h1>{facility?.name ?? ''}</h1>
              {appUser?.role !== 'admin' && (
                <p className="muted">閲覧のみ（管理者ではありません）</p>
              )}
            </div>
            <div className="header-actions">
              {facilities.length > 1 && (
                <button type="button" onClick={() => selectFacility('')}>
                  施設を変更
                </button>
              )}
              <button type="button" onClick={() => void signOut()}>
                ログアウト
              </button>
            </div>
          </div>

          <div className="app-shell wide embedded">
            <Routes>
              <Route path="/shift" element={<ShiftGridPage />} />
              <Route path="/wishes" element={<WishesPage />} />
              <Route path="/staff" element={<StaffListPage />} />
              <Route path="/staff/new" element={<StaffFormPage />} />
              <Route path="/staff/:staffId" element={<StaffFormPage />} />
              <Route path="/compatibility" element={<CompatibilityPage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/shift-patterns" element={<ShiftPatternsPage />} />
              <Route path="/job-types" element={<JobTypesPage />} />
              <Route path="/employment-types" element={<EmploymentTypesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/import-legacy" element={<ImportLegacyPage />} />
              <Route path="*" element={<Navigate to="/shift" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </MastersProvider>
  )
}
