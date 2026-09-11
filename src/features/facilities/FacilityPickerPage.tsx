import { useFacility } from '../../context/FacilityContext'

export default function FacilityPickerPage() {
  const { facilities, selectFacility } = useFacility()

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
      </section>
    </main>
  )
}
