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

const TABS = [
  { to: '/shift', label: 'シフト表' },
  { to: '/staff', label: '職員' },
  { to: '/shift-patterns', label: '勤務パターン' },
  { to: '/job-types', label: '職種' },
  { to: '/employment-types', label: '雇用区分' },
]

export default function FacilityShell() {
  const { signOut } = useAuth()
  const { appUser, facilities, selectedFacilityId, selectFacility } = useFacility()
  const facility = facilities.find((f) => f.id === selectedFacilityId)

  if (!selectedFacilityId) return null

  return (
    <MastersProvider facilityId={selectedFacilityId}>
      <div className="app-shell wide">
        <div className="page-header">
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

        <nav className="tabbar">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>

        <Routes>
          <Route path="/shift" element={<ShiftGridPage />} />
          <Route path="/staff" element={<StaffListPage />} />
          <Route path="/staff/new" element={<StaffFormPage />} />
          <Route path="/staff/:staffId" element={<StaffFormPage />} />
          <Route path="/shift-patterns" element={<ShiftPatternsPage />} />
          <Route path="/job-types" element={<JobTypesPage />} />
          <Route path="/employment-types" element={<EmploymentTypesPage />} />
          <Route path="*" element={<Navigate to="/shift" replace />} />
        </Routes>
      </div>
    </MastersProvider>
  )
}
