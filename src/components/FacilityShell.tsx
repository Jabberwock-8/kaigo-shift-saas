import { lazy, Suspense } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
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
import PaidLeavePage from '../features/paidLeave/PaidLeavePage'
import CompatibilityPage from '../features/compatibility/CompatibilityPage'
import RulesPage from '../features/rules/RulesPage'
import SettingsPage from '../features/settings/SettingsPage'
import FacilityTabs from './FacilityTabs'

// Excel入出力・旧データ取込は、たまにしか使わない取込用の画面で、Excel処理ライブラリ（xlsx）が大きい。
// 常に読み込むと全画面の初回表示が重くなるため、開いたときだけ読み込む
const ExcelPage = lazy(() => import('../features/excel/ExcelPage'))
const ImportLegacyPage = lazy(() => import('../features/importLegacy/ImportLegacyPage'))

const TABS = [
  { to: '/shift', label: 'シフト表', icon: '📅' },
  { to: '/wishes', label: '希望休', icon: '🙋' },
  { to: '/paid-leave', label: '有給休暇', icon: '🌴' },
  { to: '/staff', label: '職員', icon: '👤' },
  { to: '/compatibility', label: '相性', icon: '🤝' },
  { to: '/rules', label: '条件', icon: '📋' },
  { to: '/shift-patterns', label: '勤務パターン', icon: '🕒' },
  { to: '/job-types', label: '職種', icon: '🏷️' },
  { to: '/employment-types', label: '雇用区分', icon: '📁' },
  { to: '/settings', label: '設定', icon: '⚙️' },
  { to: '/excel', label: 'Excel入出力', icon: '📊' },
  { to: '/import-legacy', label: '旧データ取込', icon: '🗂️' },
]

export default function FacilityShell() {
  const { signOut } = useAuth()
  const { appUser, selectedFacilityId } = useFacility()

  if (!selectedFacilityId) return null

  return (
    <MastersProvider facilityId={selectedFacilityId}>
      <div className="app-layout">
        <aside className="sidebar no-print">
          <div className="sidebar-logo">
            SHIFT
            <br />
            MAKER
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
          <div className="sidebar-footer">
            {appUser?.role === 'admin' && (
              <Link to="/org-admin" className="navbtn">
                <span className="nico">🏢</span>
                施設・ユーザー管理
              </Link>
            )}
            <button type="button" className="navbtn sidebar-logout" onClick={() => void signOut()}>
              <span className="nico">🚪</span>
              ログアウト
            </button>
          </div>
        </aside>

        <div className="main-area">
          <FacilityTabs />
          {appUser?.role !== 'admin' && (
            <p className="muted no-print" style={{ margin: '0 0 10px' }}>
              閲覧のみ（管理者ではありません）
            </p>
          )}

          <div className="app-shell wide embedded">
            <Routes>
              <Route path="/shift" element={<ShiftGridPage />} />
              <Route path="/wishes" element={<WishesPage />} />
              <Route path="/paid-leave" element={<PaidLeavePage />} />
              <Route path="/staff" element={<StaffListPage />} />
              <Route path="/staff/new" element={<StaffFormPage />} />
              <Route path="/staff/:staffId" element={<StaffFormPage />} />
              <Route path="/compatibility" element={<CompatibilityPage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/shift-patterns" element={<ShiftPatternsPage />} />
              <Route path="/job-types" element={<JobTypesPage />} />
              <Route path="/employment-types" element={<EmploymentTypesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route
                path="/excel"
                element={
                  <Suspense fallback={<p className="muted">読み込み中…</p>}>
                    <ExcelPage />
                  </Suspense>
                }
              />
              <Route
                path="/import-legacy"
                element={
                  <Suspense fallback={<p className="muted">読み込み中…</p>}>
                    <ImportLegacyPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<Navigate to="/shift" replace />} />
            </Routes>
          </div>
        </div>
      </div>
    </MastersProvider>
  )
}
