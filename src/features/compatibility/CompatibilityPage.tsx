import { useEffect, useState } from 'react'
import { useFacility } from '../../context/FacilityContext'
import { fetchStaffList, listCompatibilities, setCompatibility } from '../../lib/firestore'
import type { Compatibility, CompatibilityLevel, Staff } from '../../types/models'

type StaffWithId = Staff & { id: string }

const CYCLE: (CompatibilityLevel | null)[] = [null, 'double', 'caution', 'x']
const MARK: Record<'null' | CompatibilityLevel, string> = {
  null: '○',
  double: '◎',
  caution: '△',
  x: '×',
}
const CLASS: Record<'null' | CompatibilityLevel, string> = {
  null: 'lv-good',
  double: 'lv-double',
  caution: 'lv-caution',
  x: 'lv-x',
}

export default function CompatibilityPage() {
  const { appUser, selectedFacilityId } = useFacility()
  const isAdmin = appUser?.role === 'admin'

  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [levels, setLevels] = useState<Map<string, CompatibilityLevel>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    try {
      const [sl, comps] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        listCompatibilities(selectedFacilityId),
      ])
      setStaffList(sl.filter((s) => s.active !== false))
      const map = new Map<string, CompatibilityLevel>()
      comps.forEach((c: Compatibility) => {
        map.set(pairKey(c.staffIdA, c.staffIdB), c.level)
      })
      setLevels(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId])

  if (!selectedFacilityId) return null

  function pairKey(a: string, b: string) {
    return [a, b].sort().join('__')
  }

  async function handleClick(a: string, b: string) {
    if (!isAdmin || a === b) return
    const key = pairKey(a, b)
    const cur = levels.get(key) ?? null
    const nextIndex = (CYCLE.indexOf(cur) + 1) % CYCLE.length
    const next = CYCLE[nextIndex]

    setLevels((prev) => {
      const m = new Map(prev)
      if (next) m.set(key, next)
      else m.delete(key)
      return m
    })
    try {
      await setCompatibility(selectedFacilityId!, a, b, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
    }
  }

  return (
    <section className="card">
      <h2>相性マトリクス</h2>
      {loading && <p className="muted">読み込み中…</p>}
      {error && <p className="warn">{error}</p>}
      {!loading && staffList.length < 2 && (
        <p className="muted">職員を2名以上登録すると相性を設定できます。</p>
      )}

      {staffList.length >= 2 && (
        <div className="grid-scroll">
          <table className="compat-table">
            <thead>
              <tr>
                <th></th>
                {staffList.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffList.map((a) => (
                <tr key={a.id}>
                  <th className="namecol">{a.name}</th>
                  {staffList.map((b) => {
                    if (a.id === b.id)
                      return <td key={b.id} className="compat-cell self"></td>
                    const level = levels.get(pairKey(a.id, b.id)) ?? null
                    const key = (level ?? 'null') as 'null' | CompatibilityLevel
                    return (
                      <td
                        key={b.id}
                        className={`compat-cell ${CLASS[key]} ${isAdmin ? 'clickable' : ''}`}
                        onClick={() => void handleClick(a.id, b.id)}
                      >
                        {MARK[key]}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 10 }}>
        クリックで ○→◎→△→×→○ と切り替わります。◎=良い（加点）／○=普通／△=注意（減点）／×=同一シフト不可。
      </p>
    </section>
  )
}
