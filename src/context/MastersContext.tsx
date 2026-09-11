import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { listEmploymentTypes, listJobTypes, listShiftPatterns } from '../lib/firestore'
import type { EmploymentType, JobType, ShiftPattern } from '../types/models'

type WithId<T> = T & { id: string }

interface MastersContextValue {
  jobTypes: WithId<JobType>[]
  employmentTypes: WithId<EmploymentType>[]
  shiftPatterns: WithId<ShiftPattern>[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const MastersContext = createContext<MastersContextValue | null>(null)

export function MastersProvider({
  facilityId,
  children,
}: {
  facilityId: string
  children: ReactNode
}) {
  const [jobTypes, setJobTypes] = useState<WithId<JobType>[]>([])
  const [employmentTypes, setEmploymentTypes] = useState<WithId<EmploymentType>[]>([])
  const [shiftPatterns, setShiftPatterns] = useState<WithId<ShiftPattern>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [jt, et, sp] = await Promise.all([
        listJobTypes(facilityId),
        listEmploymentTypes(facilityId),
        listShiftPatterns(facilityId),
      ])
      setJobTypes(jt)
      setEmploymentTypes(et)
      setShiftPatterns(sp)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [facilityId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <MastersContext.Provider
      value={{ jobTypes, employmentTypes, shiftPatterns, loading, error, refresh }}
    >
      {children}
    </MastersContext.Provider>
  )
}

export function useMasters() {
  const ctx = useContext(MastersContext)
  if (!ctx) throw new Error('useMasters は MastersProvider の内側で使ってください')
  return ctx
}
