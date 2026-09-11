import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { useAuth } from './context/AuthContext'
import { FacilityProvider, useFacility } from './context/FacilityContext'
import { firebaseStatus } from './lib/firebase'
import LoginPage from './features/auth/LoginPage'
import FacilityPickerPage from './features/facilities/FacilityPickerPage'
import StaffListPage from './features/staff/StaffListPage'

function ConfigMissing() {
  return (
    <main className="app-shell">
      <h1>介護シフト作成</h1>
      <section className="card">
        <p className="warn">
          Firebase が未設定です。<code>.env.development</code> または{' '}
          <code>.env.production</code> を確認してください。
        </p>
      </section>
    </main>
  )
}

function Loading() {
  return (
    <main className="app-shell">
      <p className="muted">読み込み中…</p>
    </main>
  )
}

/** ログイン済みのときだけ中身を表示。未ログインは /login へ */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** users ドキュメント読み込み・施設選択の状態に応じて出し分け */
function HomeRoute() {
  const { loading, error, appUser, facilities, selectedFacilityId } =
    useFacility()

  if (loading) return <Loading />

  if (error) {
    return (
      <main className="app-shell">
        <section className="card">
          <p className="warn">{error}</p>
        </section>
      </main>
    )
  }

  if (!appUser || facilities.length === 0) {
    return (
      <main className="app-shell">
        <section className="card">
          <p className="warn">
            所属施設が見つかりません。管理者に確認してください。
          </p>
        </section>
      </main>
    )
  }

  if (!selectedFacilityId) {
    return <FacilityPickerPage />
  }

  return <StaffListPage />
}

export default function App() {
  if (!firebaseStatus.configured) {
    return <ConfigMissing />
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <FacilityProvider>
              <HomeRoute />
            </FacilityProvider>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
