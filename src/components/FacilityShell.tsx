import { lazy, Suspense, useState, type ComponentType } from 'react'
import {
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock,
  FileSpreadsheet,
  FolderInput,
  Handshake,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Palmtree,
  SlidersHorizontal,
  Tag,
  User,
  type LucideProps,
} from 'lucide-react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'
import { isDevEnvironment } from '../lib/firebase'
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

type NavItem = { to: string; label: string; Icon: ComponentType<LucideProps> }

/**
 * サイドバーの項目（改善指示書 D3。remaining-work-design.md §25）。3つのまとまりに分ける。
 * 行き先（URL）は分ける前と同じ
 */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '毎月の作業',
    items: [
      { to: '/shift', label: 'シフト表', Icon: CalendarDays },
      { to: '/wishes', label: '希望休', Icon: CalendarCheck },
      { to: '/paid-leave', label: '有給休暇', Icon: Palmtree },
    ],
  },
  {
    title: '施設の設定',
    items: [
      { to: '/staff', label: '職員', Icon: User },
      { to: '/compatibility', label: '相性', Icon: Handshake },
      { to: '/rules', label: '条件', Icon: ListChecks },
      { to: '/shift-patterns', label: '勤務パターン', Icon: Clock },
      { to: '/job-types', label: '職種', Icon: Tag },
      { to: '/employment-types', label: '雇用区分', Icon: Briefcase },
      { to: '/settings', label: '設定', Icon: SlidersHorizontal },
    ],
  },
  {
    title: 'データ',
    items: [
      { to: '/excel', label: 'Excel入出力', Icon: FileSpreadsheet },
      { to: '/import-legacy', label: '旧データ取込', Icon: FolderInput },
    ],
  },
]

/** サイドバーを折りたたんでいるか（その PC のブラウザに覚える。読めない・書けないときは広げた状態） */
const SIDEBAR_KEY = 'shiftMaker.sidebarCollapsed'
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0')
  } catch {
    // 覚えられなくても、その画面を開いている間は切り替わる
  }
}

const ICON_SIZE = 18

export default function FacilityShell() {
  const { signOut } = useAuth()
  const { appUser, selectedFacilityId } = useFacility()
  const [collapsed, setCollapsed] = useState(readCollapsed)

  if (!selectedFacilityId) return null

  function toggleCollapsed() {
    setCollapsed((v) => {
      writeCollapsed(!v)
      return !v
    })
  }

  return (
    <MastersProvider facilityId={selectedFacilityId}>
      <div className="app-layout">
        <aside
          className={`sidebar no-print${collapsed ? ' collapsed' : ''}${isDevEnvironment ? ' sidebar-dev' : ''}`}
          aria-label="メニュー"
        >
          <div className="sidebar-head">
            {!collapsed && (
              <div className="sidebar-logo">
                <span className="sidebar-logo-mark" aria-hidden="true">
                  <CalendarDays size={16} strokeWidth={2} />
                </span>
                SHIFT MAKER
              </div>
            )}
            <button
              type="button"
              className="sidebar-toggle"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'サイドバーを広げる' : 'サイドバーを折りたたむ'}
              title={collapsed ? 'サイドバーを広げる' : 'サイドバーを折りたたむ'}
            >
              {collapsed ? <PanelLeftOpen size={ICON_SIZE} aria-hidden="true" /> : <PanelLeftClose size={ICON_SIZE} aria-hidden="true" />}
            </button>
          </div>
          <nav className="sidebar-nav">
            {NAV_GROUPS.map((g) => (
              <div key={g.title} className="sidebar-group">
                {!collapsed && <div className="sidebar-group-title">{g.title}</div>}
                {g.items.map(({ to, label, Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? label : undefined}
                  >
                    <Icon className="nico" size={ICON_SIZE} strokeWidth={1.8} aria-hidden="true" />
                    {!collapsed && <span>{label}</span>}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            {appUser?.role === 'admin' && (
              <Link
                to="/org-admin"
                className="navbtn"
                title={collapsed ? '施設・ユーザー管理' : undefined}
                aria-label={collapsed ? '施設・ユーザー管理' : undefined}
              >
                <Building2 className="nico" size={ICON_SIZE} strokeWidth={1.8} aria-hidden="true" />
                {!collapsed && <span>施設・ユーザー管理</span>}
              </Link>
            )}
            <button
              type="button"
              className="navbtn sidebar-logout"
              onClick={() => void signOut()}
              title={collapsed ? 'ログアウト' : undefined}
              aria-label={collapsed ? 'ログアウト' : undefined}
            >
              <LogOut className="nico" size={ICON_SIZE} strokeWidth={1.8} aria-hidden="true" />
              {!collapsed && <span>ログアウト</span>}
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
