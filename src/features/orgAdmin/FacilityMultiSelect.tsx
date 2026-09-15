import type { Facility } from '../../types/models'

type FacilityWithId = Facility & { id: string }

interface Props {
  facilities: FacilityWithId[]
  selectedIds: string[]
  primaryId?: string
  onAdd: (id: string) => void
  onRemove: (id: string) => void
}

/**
 * 所属施設の選択。プルダウンで1件ずつ追加し、選んだ施設はチップで表示（クリックで外す）。
 * 施設数が増える運用を想定し、トグルボタンをずらっと並べる方式はやめてこちらにした。
 */
export default function FacilityMultiSelect({ facilities, selectedIds, primaryId, onAdd, onRemove }: Props) {
  const available = facilities.filter((f) => !selectedIds.includes(f.id))
  const facilityById = new Map(facilities.map((f) => [f.id, f]))

  return (
    <div>
      {selectedIds.length > 0 && (
        <div className="facility-chip-row" style={{ marginBottom: available.length > 0 ? 8 : 0 }}>
          {selectedIds.map((id) => {
            const f = facilityById.get(id)
            return (
              <button
                key={id}
                type="button"
                className="facility-chip selected"
                onClick={() => onRemove(id)}
                title="クリックで外す"
              >
                {f?.shortName ?? f?.name ?? id}
                {primaryId === id && ' ★'}
                <span className="facility-chip-remove">×</span>
              </button>
            )
          })}
        </div>
      )}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value)
          }}
        >
          <option value="">＋ 施設を選んで追加</option>
          {available.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
