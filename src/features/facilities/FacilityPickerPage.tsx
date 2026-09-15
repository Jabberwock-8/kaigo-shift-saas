import { Link } from 'react-router-dom'
import { useFacility } from '../../context/FacilityContext'

export default function FacilityPickerPage() {
  const { appUser, facilities, selectFacility } = useFacility()

  return (
    <main className="app-shell">
      <h1>施設を選択</h1>
      <section className="card">
        <ul className="list-plain">
          {facilities.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => selectFacility(f.id)}>
                {f.name}
              </button>
            </li>
          ))}
        </ul>
        {appUser?.role === 'admin' && (
          <p style={{ marginTop: 14 }}>
            <Link to="/org-admin" className="header-link-btn">
              ⚙️ 施設・ユーザー管理
            </Link>
          </p>
        )}
      </section>
    </main>
  )
}
