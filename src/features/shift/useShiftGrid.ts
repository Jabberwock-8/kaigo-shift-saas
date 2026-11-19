import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import {
  DEFAULT_SHIFT_RULES_SETTINGS,
  adoptCandidate,
  clearScheduleEditLock,
  setScheduleEditLock,
  ScheduleChangedError,
  ScheduleLockedError,
  clearAllLocks,
  fetchCurrentGenerationConfig,
  fetchLeaveRequestsForMonth,
  fetchSchedule,
  fetchShiftRulesSettings,
  fetchStaffList,
  fetchTimeproExportSettings,
  listCandidates,
  listCompatibilities,
  listRules,
  loadGenerateInput,
  saveCandidates,
  setAssignment,
  setEvent,
  setLock,
  setSecondaryAssignment,
} from '../../lib/firestore'
import type {
  Compatibility,
  LeaveRequest,
  Rule,
  Schedule,
  ShiftRulesSettings,
  Staff,
  TimeproPatternMapEntry,
} from '../../types/models'
import {
  currentYearMonth,
  daysInMonth as daysInMonthOf,
  formatYearMonthLabel,
  shiftDurationHours,
  shiftYearMonth,
  weekIndexOfToday,
  weeksOfMonth,
} from '../../lib/dateUtils'
import { prepareBackupFolder, saveFacilityBackup } from '../../lib/autoBackup'
import { checkMonth } from '../../domain/scheduler/check'
import { demandFor } from '../../domain/scheduler/demand'
import { GenerationCancelledError, runGenerate, type GenerateProgress } from '../generate/runGenerate'
import { resolveLimits } from '../../domain/scheduler/limits'
import type { Candidate, PrevMonthTail } from '../../domain/scheduler/types'
import { prevMonthTail } from '../../domain/scheduler/gridUtils'
import { downloadShiftExcel } from './exportShiftExcel'
import { hashEditLockPassword, newEditLockSalt } from '../../lib/editLock'
import { staffShownInMonth } from '../../lib/staffUtils'

/**
 * シフト表の状態と処理（読み込み・1マスの保存・ロック・行事・生成・採択など）。
 * 改善指示書 D7 で ShiftGridPage.tsx から行の中身を変えずに移した（remaining-work-design.md §26）。
 * 保存処理の呼び方は移す前と同じ。画面の部品（ShiftToolbar など）はここが返す値を受け取って描く
 */
type StaffWithId = Staff & { id: string }

export function useShiftGrid() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId, facilities } = useFacility()
  const { shiftPatterns, employmentTypes, loading: mastersLoading } = useMasters()
  const isAdmin = appUser?.role === 'admin'
  const selectedFacility = facilities.find((f) => f.id === selectedFacilityId)
  const facilityName = selectedFacility?.name ?? ''

  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  // 施設の全職員（無効も含む）。表に出すのは staffList（有効な職員＋その月に入力がある無効の職員。§18 A2）
  const [staffAll, setStaffAll] = useState<StaffWithId[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const staffList = useMemo(
    () => staffShownInMonth(staffAll, schedule?.assignments, schedule?.secondaryAssignments),
    [staffAll, schedule?.assignments, schedule?.secondaryAssignments],
  )
  // 編集ロックを一時解除している月（施設ID/年月）。月・施設を移るか再読み込みすると消え、ロックに戻る
  const [unlockedKey, setUnlockedKey] = useState<string | null>(null)
  const [editLockModal, setEditLockModal] = useState<'lock' | 'unlock' | null>(null)
  // 前月末の勤務（月をまたぐ夜勤明け・連続勤務の違反チェック用）
  const [prevTail, setPrevTail] = useState<PrevMonthTail | undefined>(undefined)
  const [rules, setRules] = useState<(Rule & { id: string })[]>([])
  const [compatibilities, setCompatibilities] = useState<(Compatibility & { id: string })[]>([])
  const [wishes, setWishes] = useState<(LeaveRequest & { id: string })[]>([])
  const [settings, setSettings] = useState<ShiftRulesSettings>(DEFAULT_SHIFT_RULES_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState<
    { staffId: string; day: number; rect: DOMRect; kind: 'primary' | 'secondary' } | null
  >(
    null,
  )
  const [eventPicker, setEventPicker] = useState<{ day: number; rect: DOMRect } | null>(null)

  const [storedCandidates, setStoredCandidates] = useState<(Candidate & { id: string })[]>([])
  const [candidates, setCandidates] = useState<(Candidate & { id: string })[] | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  // 生成の進み具合（案A 作成中…（1/3））と中止（§21 B1）
  const [genProgress, setGenProgress] = useState<GenerateProgress | null>(null)
  const [genNotice, setGenNotice] = useState<string | null>(null)
  const genAbortRef = useRef<AbortController | null>(null)
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  // クリック直後は state 更新がまだ描画に反映されておらず、連打でボタンの disabled が
  // 効く前に二重起動しうるため、同期的に効く ref でも二重起動を防ぐ
  const generatingRef = useRef(false)

  const [showLimitsModal, setShowLimitsModal] = useState(false)
  const [showBulkFill, setShowBulkFill] = useState(false)
  const [bulkMsg, setBulkMsg] = useState<string | null>(null)
  const [showViolationList, setShowViolationList] = useState(false)
  const [showTimeproModal, setShowTimeproModal] = useState(false)
  const [showSubmissionModal, setShowSubmissionModal] = useState(false)
  const [timeproPatternMap, setTimeproPatternMap] = useState<Record<string, TimeproPatternMapEntry>>({})

  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [weekIndex, setWeekIndex] = useState(0)
  const [fitToScreen, setFitToScreen] = useState(false)
  // ツールバーのドロップダウンメニュー（出力／その他）。1段化のため二次操作を集約する
  const [openMenu, setOpenMenu] = useState<'export' | 'misc' | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return
    function onPointerDown(e: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])
  const [fitScale, setFitScale] = useState({ x: 1, y: 1 })
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const gridTableRef = useRef<HTMLTableElement>(null)

  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)
  const weeks = weeksOfMonth(yearMonth)
  const currentWeek = weeks[Math.min(weekIndex, weeks.length - 1)]
  const isWeek = viewMode === 'week'
  // 表に並べる日。月の集計（個人別の回数・常勤換算・夜勤目標・違反チェック）は常に月全体で数える
  const visibleDays = isWeek ? currentWeek : dayList

  /** 月を切り替える。週表示のときは、今月なら今日を含む週・それ以外は第1週を開く */
  function moveMonth(next: string) {
    setPicker(null)
    setYearMonth(next)
    setWeekIndex(weekIndexOfToday(next))
  }

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    setCandidates(null)
    setPreviewId(null)
    try {
      const prevYm = shiftYearMonth(yearMonth, -1)
      const [sl, sc, rl, cl, wl, st, cd, tp, prevSc] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchSchedule(selectedFacilityId, yearMonth),
        listRules(selectedFacilityId),
        listCompatibilities(selectedFacilityId),
        fetchLeaveRequestsForMonth(selectedFacilityId, yearMonth),
        fetchShiftRulesSettings(selectedFacilityId),
        listCandidates(selectedFacilityId, yearMonth),
        fetchTimeproExportSettings(selectedFacilityId),
        fetchSchedule(selectedFacilityId, prevYm),
      ])
      setStaffAll(sl)
      setSchedule(sc)
      setPrevTail(prevSc ? prevMonthTail(prevSc.assignments, daysInMonthOf(prevYm)) : undefined)
      setRules(rl)
      setCompatibilities(cl)
      setWishes(wl)
      setSettings(st)
      setStoredCandidates(cd)
      setTimeproPatternMap(tp.patternMap)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // 画面を離れたら生成を止める
  useEffect(() => () => genAbortRef.current?.abort('navigate'), [])

  useEffect(() => {
    setUnlockedKey(null)
    setBulkMsg(null)
    setGenNotice(null)
    // 月・施設を移ったら生成を止める（古い月の案が新しい月の画面に出ないように）
    genAbortRef.current?.abort('navigate')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId, yearMonth])

  const monthKey = `${selectedFacilityId}/${yearMonth}`
  const editLocked = !!schedule?.editLock
  const tempUnlocked = editLocked && unlockedKey === monthKey
  const canEditMonth = isAdmin && (!editLocked || tempUnlocked)

  /**
   * 勤務表への書き込みに失敗したとき。画面を読み込み直して実際の状態を見せてから、案内を出す
   * （load() は始めに error を消すので、表示は読み込みの後。ロックされていたら ScheduleLockedError の文言。§18 A4）
   */
  async function handleWriteError(e: unknown) {
    await load()
    setError(e instanceof Error ? e.message : String(e))
  }

  async function handleLock(password: string) {
    if (!selectedFacilityId || !user) return
    const salt = newEditLockSalt()
    await setScheduleEditLock(selectedFacilityId, yearMonth, days, { hash: await hashEditLockPassword(password, salt), salt }, user.uid)
    setCandidates(null)
    setPreviewId(null)
    setPicker(null)
    setEventPicker(null)
    setUnlockedKey(null)
    setEditLockModal(null)
    await load()
  }

  async function handleRemoveLock() {
    if (!selectedFacilityId) return
    if (!confirm(`${formatYearMonthLabel(yearMonth)}のロックを外します（パスワードなしで誰でも変更できる状態に戻ります）。よろしいですか？`)) return
    try {
      await clearScheduleEditLock(selectedFacilityId, yearMonth)
      setUnlockedKey(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const previewCandidate = candidates?.find((c) => c.id === previewId) ?? null
  const effectiveAssignments = useMemo(
    () => previewCandidate?.assignments ?? schedule?.assignments ?? {},
    [previewCandidate, schedule],
  )

  const checkResult = useMemo(
    () =>
      checkMonth({
        yearMonth,
        daysInMonth: days,
        staff: staffList,
        employmentTypes,
        shiftPatterns,
        assignments: effectiveAssignments,
        secondaryAssignments: schedule?.secondaryAssignments,
        rules,
        compatibilities,
        settings,
        monthlyMaxDaysOverride: schedule?.monthlyMaxDaysOverride,
        prevTail,
      }),
    [
      yearMonth,
      days,
      staffList,
      employmentTypes,
      shiftPatterns,
      effectiveAssignments,
      schedule?.secondaryAssignments,
      rules,
      compatibilities,
      settings,
      schedule?.monthlyMaxDaysOverride,
      prevTail,
    ],
  )

  async function handleGenerate() {
    if (!selectedFacilityId || generatingRef.current) return
    generatingRef.current = true
    const abort = new AbortController()
    genAbortRef.current = abort
    setGenerating(true)
    setGenProgress(null)
    setGenError(null)
    setGenNotice(null)
    setPreviewId(null)
    try {
      // 案を作る時点の勤務表の版を先に控える（採択時に、その後の手直しを上書きしないか確かめるため）
      const baseSchedule = await fetchSchedule(selectedFacilityId, yearMonth)
      const baseRevision = baseSchedule?.revision ?? 0
      const input = await loadGenerateInput(selectedFacilityId, yearMonth)
      // 生成の対象外の職員（シフト作成の対象外・無効・削除済み）は生成に含めないので、入っている勤務を案にそのまま残す
      // （採択は assignments を置き換えるため、残さないと消える。§18 A2）
      const generatedIds = new Set(input.staff.map((s) => s.id))
      const kept = Object.fromEntries(
        Object.entries(baseSchedule?.assignments ?? {}).filter(([staffId]) => !generatedIds.has(staffId)),
      )
      // 画面とは別の所（Worker）で作る。中止したら何も保存しない
      const generated = await runGenerate(input, { onProgress: setGenProgress, signal: abort.signal })
      if (abort.signal.aborted) throw new GenerationCancelledError()
      const result = generated.map((c) => ({ ...c, assignments: { ...kept, ...c.assignments }, baseRevision }))
      const saved = await saveCandidates(selectedFacilityId, yearMonth, result)
      setCandidates(saved)
      setStoredCandidates(saved)
    } catch (e) {
      if (e instanceof GenerationCancelledError) {
        // 月・施設を移って止めたときは、新しい画面に案内を出さない
        if (abort.signal.reason !== 'navigate') setGenNotice('生成を中止しました。勤務表と前回の案は変わっていません。')
      } else {
        setGenError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (genAbortRef.current === abort) genAbortRef.current = null
      generatingRef.current = false
      setGenerating(false)
      setGenProgress(null)
    }
  }

  async function handleAdopt(candidate: Candidate & { id: string }) {
    // 新しい案の作成中は採択しない（§21 B1）
    if (!selectedFacilityId || !user || generatingRef.current) return
    if (candidate.hardCount > 0 && !confirm(`この案には必須条件の違反が${candidate.hardCount}件あります。採択しますか？`)) {
      return
    }
    // 保存先フォルダへの書き込み許可はボタン操作の直後でないと求められないため、採択の前に確認しておく
    const useFolder = await prepareBackupFolder()
    setAdoptingId(candidate.id)
    setGenError(null)
    setBackupMsg(null)
    try {
      const configSnapshot = await fetchCurrentGenerationConfig(selectedFacilityId)
      try {
        await adoptCandidate(selectedFacilityId, yearMonth, days, candidate, candidate.id, user.uid, configSnapshot, false, tempUnlocked)
      } catch (e) {
        if (!(e instanceof ScheduleChangedError)) throw e
        if (
          !confirm(
            '案を作ったあとに、この月の勤務表が変更されています（手直し・ロックなど）。\n採択すると、その変更は案の内容で上書きされます。それでも採択しますか？\n\n（変更を活かしたいときは「キャンセル」を押し、案を作り直してください）',
          )
        ) {
          return
        }
        await adoptCandidate(selectedFacilityId, yearMonth, days, candidate, candidate.id, user.uid, configSnapshot, true, tempUnlocked)
      }
      setCandidates(null)
      setPreviewId(null)
      setStoredCandidates([])
      await load()
      // 採択後の自動バックアップ。失敗しても採択は済んでいるので、案内だけ出す
      try {
        const { fileName, savedTo } = await saveFacilityBackup(selectedFacilityId, facilityName, yearMonth, useFolder)
        setBackupMsg(`バックアップを${savedTo}に保存しました（${fileName}）`)
      } catch (e) {
        setGenError(
          `採択は完了しましたが、バックアップを保存できませんでした。施設・ユーザー管理の「書き出す」で手動で保存してください。（${e instanceof Error ? e.message : String(e)}）`,
        )
      }
    } catch (e) {
      if (e instanceof ScheduleLockedError) {
        // ほかの画面でロックされた。採択はしていない（保存済みの案は残る）。勤務表を読み込み直して案内する
        await handleWriteError(e)
      } else {
        setGenError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setAdoptingId(null)
    }
  }

  const wishDates = useMemo(() => {
    const map = new Map<string, LeaveRequest & { id: string }>()
    wishes.forEach((w) => map.set(`${w.staffId}_${w.date}`, w))
    return map
  }, [wishes])

  // 表の枠の下の端を、いつも画面の下の端にそろえる。枠の高さを固定値にすると、表の上にあるボタンや
  // 夜勤回数の行の分だけ枠が画面の外にはみ出し、枠の下にある横スクロールバーが見えなくなっていた。
  // 表の上の量やページのスクロール位置で変わるため、描画のたび・スクロール・画面サイズの変更で計算し直す
  useLayoutEffect(() => {
    const el = gridScrollRef.current
    if (!el || fitToScreen) return
    function fit() {
      if (!el) return
      const top = Math.max(0, el.getBoundingClientRect().top)
      el.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`
    }
    fit()
    window.addEventListener('resize', fit)
    // 施設の画面はページ全体ではなく内側の要素がスクロールすることがあるため、取りこぼさないよう捕捉段階で拾う
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
      el.style.maxHeight = ''
    }
  })

  // 「画面に収める」: はみ出す分だけ表全体を縮小して、横/縦スクロールなしで全体を見せる
  useLayoutEffect(() => {
    if (!fitToScreen) return
    function recalc() {
      if (!gridTableRef.current || !gridScrollRef.current) return
      const w = gridTableRef.current.scrollWidth
      const h = gridTableRef.current.scrollHeight
      if (!w || !h) return
      setNaturalSize({ w, h })
      const availW = gridScrollRef.current.clientWidth
      const top = gridScrollRef.current.getBoundingClientRect().top
      const availH = window.innerHeight - top - 16
      // 縦横は別々の倍率で伸縮させ、表示スペースを幅・高さとも端から端まで使う（アスペクト比は崩れる）
      setFitScale({
        x: availW > 0 && w > 0 ? availW / w : 1,
        y: availH > 0 && h > 0 ? availH / h : 1,
      })
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [fitToScreen, staffList.length, days, loading, viewMode, weekIndex])


  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const employmentTypeById = new Map(employmentTypes.map((e) => [e.id, e]))
  const summaryPatterns = shiftPatterns.filter((p) => p.isWork || p.category === 'off')
  const workPatterns = shiftPatterns.filter((p) => p.isWork)

  // 常勤換算の分母（所定労働時間 = その月の常勤の必要勤務日数 × 8時間）。
  // 「月の上限を調整」で施設一律に上書きされる想定のため、常勤の誰か1人の値を代表として使う。
  const standardWorkdays = staffList
    .map(
      (s) =>
        resolveLimits(s, employmentTypeById.get(s.employmentTypeId ?? ''), settings, schedule?.monthlyMaxDaysOverride?.[s.id], days)
          .targetWorkdays,
    )
    .find((v): v is number => v != null)
  const standardHours = standardWorkdays != null ? standardWorkdays * 8 : null

  // 通常勤務行＋兼務行（生活相談員など）の実労働時間を合算してから1.0を上限にする
  // （行ごとに別々に上限1.0をかけると、2行分で最大2.0になってしまい常勤換算として成立しないため）
  function fteFor(staffId: string): number | null {
    if (standardHours == null || standardHours <= 0) return null
    let hours = 0
    for (let d = 1; d <= days; d++) {
      const patternId = effectiveAssignments[staffId]?.[String(d)]
      const pattern = patternId ? patternById.get(patternId) : undefined
      if (pattern?.isWork) hours += shiftDurationHours(pattern.startTime, pattern.endTime, pattern.breakHours)

      const secondaryPatternId = schedule?.secondaryAssignments?.[staffId]?.[String(d)]
      const secondaryPattern = secondaryPatternId ? patternById.get(secondaryPatternId) : undefined
      if (secondaryPattern?.isWork)
        hours += shiftDurationHours(secondaryPattern.startTime, secondaryPattern.endTime, secondaryPattern.breakHours)
    }
    return Math.min(1, Math.round((hours / standardHours) * 10) / 10)
  }

  /** 日別集計のセルの文字（画面の集計行と同じ。必要数があれば「実績/必要数」） */
  function tallyText(patternId: string, day: number): string {
    const need = demandFor(rules, yearMonth, day)[patternId]
    const actual = actualCountFor(patternId, day)
    return need == null ? String(actual) : `${actual}/${need}`
  }

  async function handleExportExcel() {
    try {
      await downloadShiftExcel({
        facilityName,
        yearMonth,
        days: dayList,
        staffList,
        shiftPatterns,
        assignments: effectiveAssignments,
        secondaryAssignments: schedule?.secondaryAssignments,
        events: schedule?.events,
        summaryPatterns,
        workPatterns,
        tallyText,
        fteFor,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function actualCountFor(patternId: string, day: number): number {
    let count = 0
    for (const staff of staffList) {
      if (effectiveAssignments[staff.id]?.[String(day)] === patternId) count++
    }
    return count
  }

  function optionsFor(staff: StaffWithId) {
    const allowed = staff.workConditions?.workablePatternIds
    if (allowed && allowed.length > 0) {
      return shiftPatterns.filter(
        (p) => allowed.includes(p.id) || p.isSystem || !p.isWork,
      )
    }
    return shiftPatterns
  }

  async function handleAssign(staffId: string, day: number, patternId: string) {
    if (!user) return
    // 楽観的に画面を先に更新
    setSchedule((prev) => {
      const base: Schedule = prev ?? {
        yearMonth,
        daysInMonth: days,
        assignments: {},
        locks: {},
      }
      const assignments = { ...(base.assignments ?? {}) }
      const staffRow = { ...(assignments[staffId] ?? {}) }
      if (patternId) staffRow[String(day)] = patternId
      else delete staffRow[String(day)]
      assignments[staffId] = staffRow
      return { ...base, assignments }
    })
    try {
      await setAssignment(
        selectedFacilityId!,
        yearMonth,
        days,
        staffId,
        day,
        patternId || null,
        user.uid,
        tempUnlocked,
      )
    } catch (e) {
      await handleWriteError(e)
    }
  }

  async function handleAssignSecondary(staffId: string, day: number, patternId: string) {
    if (!user) return
    setSchedule((prev) => {
      const base: Schedule = prev ?? { yearMonth, daysInMonth: days, assignments: {}, locks: {} }
      const secondaryAssignments = { ...(base.secondaryAssignments ?? {}) }
      const staffRow = { ...(secondaryAssignments[staffId] ?? {}) }
      if (patternId) staffRow[String(day)] = patternId
      else delete staffRow[String(day)]
      secondaryAssignments[staffId] = staffRow
      return { ...base, secondaryAssignments }
    })
    try {
      await setSecondaryAssignment(selectedFacilityId!, yearMonth, days, staffId, day, patternId || null, user.uid, tempUnlocked)
    } catch (e) {
      await handleWriteError(e)
    }
  }

  async function handleToggleLock(staffId: string, day: number, currentlyLocked: boolean) {
    if (!user) return
    setSchedule((prev) => {
      const base: Schedule = prev ?? {
        yearMonth,
        daysInMonth: days,
        assignments: {},
        locks: {},
      }
      const locks = { ...(base.locks ?? {}) }
      const staffRow = { ...(locks[staffId] ?? {}) }
      if (!currentlyLocked) staffRow[String(day)] = true
      else delete staffRow[String(day)]
      locks[staffId] = staffRow
      return { ...base, locks }
    })
    try {
      await setLock(selectedFacilityId!, yearMonth, days, staffId, day, !currentlyLocked, user.uid, tempUnlocked)
    } catch (e) {
      await handleWriteError(e)
    }
  }

  async function handleSetEvent(day: number, text: string) {
    if (!user) return
    setSchedule((prev) => {
      const base: Schedule = prev ?? {
        yearMonth,
        daysInMonth: days,
        assignments: {},
        locks: {},
      }
      const events = { ...(base.events ?? {}) }
      if (text.trim()) events[String(day)] = text.trim()
      else delete events[String(day)]
      return { ...base, events }
    })
    try {
      await setEvent(selectedFacilityId!, yearMonth, days, day, text, user.uid, tempUnlocked)
    } catch (e) {
      await handleWriteError(e)
    }
  }

  async function handleClearAllLocks() {
    if (!selectedFacilityId || !user) return
    const lockedCount = Object.values(schedule?.locks ?? {}).reduce(
      (n, byDay) => n + Object.keys(byDay).length,
      0,
    )
    if (lockedCount === 0) return
    if (!confirm(`${formatYearMonthLabel(yearMonth)}のロックを${lockedCount}件すべて解除します。よろしいですか？`)) return
    try {
      await clearAllLocks(selectedFacilityId, yearMonth, days, user.uid, tempUnlocked)
      await load()
    } catch (e) {
      await handleWriteError(e)
    }
  }


  return {
    user,
    appUser,
    selectedFacilityId,
    facilities,
    shiftPatterns,
    employmentTypes,
    mastersLoading,
    isAdmin,
    selectedFacility,
    facilityName,
    yearMonth,
    setYearMonth,
    staffAll,
    setStaffAll,
    schedule,
    setSchedule,
    staffList,
    unlockedKey,
    setUnlockedKey,
    editLockModal,
    setEditLockModal,
    prevTail,
    setPrevTail,
    rules,
    setRules,
    compatibilities,
    setCompatibilities,
    wishes,
    setWishes,
    settings,
    setSettings,
    loading,
    setLoading,
    error,
    setError,
    picker,
    setPicker,
    eventPicker,
    setEventPicker,
    storedCandidates,
    setStoredCandidates,
    candidates,
    setCandidates,
    previewId,
    setPreviewId,
    generating,
    setGenerating,
    genProgress,
    setGenProgress,
    genNotice,
    setGenNotice,
    genAbortRef,
    adoptingId,
    setAdoptingId,
    genError,
    setGenError,
    backupMsg,
    setBackupMsg,
    generatingRef,
    showLimitsModal,
    setShowLimitsModal,
    showBulkFill,
    setShowBulkFill,
    bulkMsg,
    setBulkMsg,
    showViolationList,
    setShowViolationList,
    showTimeproModal,
    setShowTimeproModal,
    showSubmissionModal,
    setShowSubmissionModal,
    timeproPatternMap,
    setTimeproPatternMap,
    viewMode,
    setViewMode,
    weekIndex,
    setWeekIndex,
    fitToScreen,
    setFitToScreen,
    openMenu,
    setOpenMenu,
    toolbarRef,
    fitScale,
    setFitScale,
    naturalSize,
    setNaturalSize,
    gridScrollRef,
    gridTableRef,
    days,
    dayList,
    weeks,
    currentWeek,
    isWeek,
    visibleDays,
    moveMonth,
    load,
    monthKey,
    editLocked,
    tempUnlocked,
    canEditMonth,
    handleWriteError,
    handleLock,
    handleRemoveLock,
    previewCandidate,
    effectiveAssignments,
    checkResult,
    handleGenerate,
    handleAdopt,
    wishDates,
    patternById,
    employmentTypeById,
    summaryPatterns,
    workPatterns,
    standardWorkdays,
    standardHours,
    fteFor,
    tallyText,
    handleExportExcel,
    actualCountFor,
    optionsFor,
    handleAssign,
    handleAssignSecondary,
    handleToggleLock,
    handleSetEvent,
    handleClearAllLocks,
  }
}

export type ShiftGrid = ReturnType<typeof useShiftGrid>
