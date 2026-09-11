import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { fetchFacilities, fetchUser } from '../lib/firestore'
import type { AppUser, Facility } from '../types/models'

type FacilityWithId = Facility & { id: string }

interface FacilityContextValue {
  appUser: AppUser | null
  facilities: FacilityWithId[]
  loading: boolean
  error: string | null
  /** 所属施設が複数あるとき、選択待ちなら null */
  selectedFacilityId: string | null
  selectFacility: (facilityId: string) => void
}

const FacilityContext = createContext<FacilityContextValue | null>(null)

export function FacilityProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [facilities, setFacilities] = useState<FacilityWithId[]>([])
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!user) {
      setAppUser(null)
      setFacilities([])
      setSelectedFacilityId(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    fetchUser(user.uid)
      .then(async (u) => {
        if (cancelled) return
        if (!u) {
          setError(
            'ログインはできましたが、このアカウントの users ドキュメントが Firestore に見つかりません。管理者に確認してください。',
          )
          setLoading(false)
          return
        }
        setAppUser(u)
        const fac = await fetchFacilities(u.facilityIds ?? [])
        if (cancelled) return
        setFacilities(fac)
        // 所属施設が1つだけなら自動選択、複数なら選択待ち（null）
        if (fac.length === 1) {
          setSelectedFacilityId(fac[0].id)
        } else if (u.primaryFacilityId && fac.some((f) => f.id === u.primaryFacilityId)) {
          setSelectedFacilityId(u.primaryFacilityId)
        } else {
          setSelectedFacilityId(null)
        }
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  return (
    <FacilityContext.Provider
      value={{
        appUser,
        facilities,
        loading,
        error,
        selectedFacilityId,
        selectFacility: setSelectedFacilityId,
      }}
    >
      {children}
    </FacilityContext.Provider>
  )
}

export function useFacility() {
  const ctx = useContext(FacilityContext)
  if (!ctx) throw new Error('useFacility は FacilityProvider の内側で使ってください')
  return ctx
}
