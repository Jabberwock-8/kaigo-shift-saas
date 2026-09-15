import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useFacility } from '../../context/FacilityContext'
import { useMasters } from '../../context/MastersContext'
import {
  DEFAULT_SHIFT_RULES_SETTINGS,
  adoptCandidate,
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
  saveMonthlyMaxDaysOverride,
  saveTimeproExportSettings,
  setAssignment,
  setEvent,
  setLock,
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
  formatDate,
  formatMonthDayWeekday,
  formatYearMonthLabel,
  shiftYearMonth,
  weekdayOf,
  WEEKDAY_LABELS,
} from '../../lib/dateUtils'
import { checkMonth } from '../../domain/scheduler/check'
import { demandFor, shiftGroupDeficitPatternIds } from '../../domain/scheduler/demand'
import { generate } from '../../domain/scheduler/generate'
import type { Candidate } from '../../domain/scheduler/types'
import PrintableShiftGrid from './PrintableShiftGrid'
import CellPicker from './CellPicker'
import EventPicker from './EventPicker'
import NightTargetPanel from './NightTargetPanel'
import CandidatesPanel from '../generate/CandidatesPanel'
import MonthlyLimitsModal from './MonthlyLimitsModal'
import TimeproModal from '../timepro/TimeproModal'

type StaffWithId = Staff & { id: string }

export default function ShiftGridPage() {
  const { user } = useAuth()
  const { appUser, selectedFacilityId, facilities } = useFacility()
  const { shiftPatterns, employmentTypes, loading: mastersLoading } = useMasters()
  const isAdmin = appUser?.role === 'admin'
  const facilityName = facilities.find((f) => f.id === selectedFacilityId)?.name ?? ''

  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const [staffList, setStaffList] = useState<StaffWithId[]>([])
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [rules, setRules] = useState<(Rule & { id: string })[]>([])
  const [compatibilities, setCompatibilities] = useState<(Compatibility & { id: string })[]>([])
  const [wishes, setWishes] = useState<(LeaveRequest & { id: string })[]>([])
  const [settings, setSettings] = useState<ShiftRulesSettings>(DEFAULT_SHIFT_RULES_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ staffId: string; day: number; rect: DOMRect } | null>(
    null,
  )
  const [eventPicker, setEventPicker] = useState<{ day: number; rect: DOMRect } | null>(null)

  const [storedCandidates, setStoredCandidates] = useState<(Candidate & { id: string })[]>([])
  const [candidates, setCandidates] = useState<(Candidate & { id: string })[] | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  // クリック直後は state 更新がまだ描画に反映されておらず、連打でボタンの disabled が
  // 効く前に二重起動しうるため、同期的に効く ref でも二重起動を防ぐ
  const generatingRef = useRef(false)

  const [showLimitsModal, setShowLimitsModal] = useState(false)
  const [showViolationList, setShowViolationList] = useState(false)
  const [showTimeproModal, setShowTimeproModal] = useState(false)
  const [timeproPatternMap, setTimeproPatternMap] = useState<Record<string, TimeproPatternMapEntry>>({})

  const days = daysInMonthOf(yearMonth)
  const dayList = Array.from({ length: days }, (_, i) => i + 1)

  async function load() {
    if (!selectedFacilityId) return
    setLoading(true)
    setError(null)
    setCandidates(null)
    setPreviewId(null)
    try {
      const [sl, sc, rl, cl, wl, st, cd, tp] = await Promise.all([
        fetchStaffList(selectedFacilityId),
        fetchSchedule(selectedFacilityId, yearMonth),
        listRules(selectedFacilityId),
        listCompatibilities(selectedFacilityId),
        fetchLeaveRequestsForMonth(selectedFacilityId, yearMonth),
        fetchShiftRulesSettings(selectedFacilityId),
        listCandidates(selectedFacilityId, yearMonth),
        fetchTimeproExportSettings(selectedFacilityId),
      ])
      setStaffList(sl.filter((s) => s.active !== false))
      setSchedule(sc)
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

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacilityId, yearMonth])

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
        rules,
        compatibilities,
        settings,
        monthlyMaxDaysOverride: schedule?.monthlyMaxDaysOverride,
      }),
    [
      yearMonth,
      days,
      staffList,
      employmentTypes,
      shiftPatterns,
      effectiveAssignments,
      rules,
      compatibilities,
      settings,
      schedule?.monthlyMaxDaysOverride,
    ],
  )

  async function handleGenerate() {
    if (!selectedFacilityId || generatingRef.current) return
    generatingRef.current = true
    setGenerating(true)
    setGenError(null)
    setPreviewId(null)
    try {
      // 旧版と同じく、生成を開始する前に1フレーム逃してボタン押下の反応を先に描画させる
      await new Promise((resolve) => setTimeout(resolve, 30))
      const input = await loadGenerateInput(selectedFacilityId, yearMonth)
      const result = generate(input)
      const saved = await saveCandidates(selectedFacilityId, yearMonth, result)
      setCandidates(saved)
      setStoredCandidates(saved)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e))
    } finally {
      generatingRef.current = false
      setGenerating(false)
    }
  }

  async function handleAdopt(candidate: Candidate & { id: string }) {
    if (!selectedFacilityId || !user) return
    if (candidate.hardCount > 0 && !confirm(`この案には必須条件の違反が${candidate.hardCount}件あります。採択しますか？`)) {
      return
    }
    setAdoptingId(candidate.id)
    setGenError(null)
    try {
      const configSnapshot = await fetchCurrentGenerationConfig(selectedFacilityId)
      await adoptCandidate(selectedFacilityId, yearMonth, days, candidate, candidate.id, user.uid, configSnapshot)
      setCandidates(null)
      setPreviewId(null)
      setStoredCandidates([])
      await load()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdoptingId(null)
    }
  }

  const wishDates = useMemo(() => {
    const map = new Map<string, LeaveRequest & { id: string }>()
    wishes.forEach((w) => map.set(`${w.staffId}_${w.date}`, w))
    return map
  }, [wishes])

  if (!selectedFacilityId) return null

  const patternById = new Map(shiftPatterns.map((p) => [p.id, p]))
  const summaryPatterns = shiftPatterns.filter((p) => p.isWork || p.category === 'off')
  const workPatterns = shiftPatterns.filter((p) => p.isWork)

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
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
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
      await setLock(selectedFacilityId!, yearMonth, days, staffId, day, !currentlyLocked, user.uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
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
      await setEvent(selectedFacilityId!, yearMonth, days, day, text, user.uid)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await load()
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
      await clearAllLocks(selectedFacilityId, yearMonth, days, user.uid)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="card">
      <div className="page-header no-print">
        <h2>{formatYearMonthLabel(yearMonth)} のシフト表</h2>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setYearMonth((ym) => shiftYearMonth(ym, -1))
            }}
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setYearMonth(currentYearMonth())
            }}
          >
            今月
          </button>
          <button
            type="button"
            onClick={() => {
              setPicker(null)
              setYearMonth((ym) => shiftYearMonth(ym, 1))
            }}
          >
            ▶
          </button>
          <button type="button" onClick={() => window.print()}>
            🖨 印刷
          </button>
          {isAdmin && (
            <button type="button" onClick={() => void handleGenerate()} disabled={generating}>
              {generating ? '生成中…' : '⚡ パターン生成'}
            </button>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setShowLimitsModal(true)}>
              📅 月の上限を調整
            </button>
          )}
          <button type="button" onClick={() => setShowTimeproModal(true)} disabled={staffList.length === 0}>
            📋 TimePro貼付用
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleClearAllLocks()}
              disabled={Object.values(schedule?.locks ?? {}).every((byDay) => Object.keys(byDay).length === 0)}
            >
              🔓 ロックを全解除
            </button>
          )}
        </div>
      </div>

      {genError && <p className="warn no-print">{genError}</p>}

      {isAdmin && !candidates && storedCandidates.length > 0 && (
        <p className="no-print" style={{ marginBottom: 10 }}>
          <button type="button" className="link-btn" onClick={() => setCandidates(storedCandidates)}>
            前回の生成結果を表示（{storedCandidates.length}案）
          </button>
        </p>
      )}

      {candidates && (
        <CandidatesPanel
          candidates={candidates}
          previewId={previewId}
          adoptingId={adoptingId}
          onPreview={(id) => setPreviewId((cur) => (cur === id ? null : id))}
          onAdopt={(c) => void handleAdopt(c)}
        />
      )}

      {previewCandidate && (
        <p className="no-print preview-banner">
          プレビュー中: {previewCandidate.label}（未確定）
          <button type="button" className="link-btn" onClick={() => void handleAdopt(previewCandidate)}>
            この案を採択
          </button>
          <button type="button" className="link-btn" onClick={() => setPreviewId(null)}>
            閉じる
          </button>
        </p>
      )}

      {!loading && (
        <NightTargetPanel
          staffList={staffList}
          shiftPatterns={shiftPatterns}
          assignments={effectiveAssignments}
          daysInMonth={days}
        />
      )}

      {!loading && !mastersLoading && (checkResult.hardCount > 0 || checkResult.softCount > 0) && (
        <div className="no-print" style={{ marginBottom: 10 }}>
          <p style={{ marginBottom: showViolationList ? 8 : 0 }}>
            {checkResult.hardCount > 0 && (
              <span className="warn" style={{ marginRight: 12 }}>
                ⚠ 必須条件の違反 {checkResult.hardCount}件
              </span>
            )}
            {checkResult.softCount > 0 && (
              <span className="muted" style={{ marginRight: 12 }}>
                推奨条件の未達 {checkResult.softCount}件
              </span>
            )}
            <button type="button" className="link-btn" onClick={() => setShowViolationList((v) => !v)}>
              {showViolationList ? '一覧を閉じる' : '違反の一覧を表示'}
            </button>
          </p>
          {showViolationList && (
            <div className="violation-list">
              {checkResult.hard.length > 0 && (
                <>
                  <h4 className="warn">必須条件の違反</h4>
                  <ul>
                    {checkResult.hard.map((msg, i) => (
                      <li key={`hard-${i}`}>{msg}</li>
                    ))}
                  </ul>
                </>
              )}
              {checkResult.soft.length > 0 && (
                <>
                  <h4 className="muted">推奨条件の未達</h4>
                  <ul>
                    {checkResult.soft.map((msg, i) => (
                      <li key={`soft-${i}`}>{msg}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {(loading || mastersLoading) && <p className="muted no-print">読み込み中…</p>}
      {error && <p className="warn no-print">{error}</p>}
      {!loading && staffList.length === 0 && (
        <p className="muted no-print">有効な職員が登録されていません。</p>
      )}
      {!loading && shiftPatterns.length === 0 && (
        <p className="warn no-print">
          勤務パターンが未登録です。先に「勤務パターン」タブで登録してください。
        </p>
      )}

      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <div className="grid-scroll no-print">
          <table className="shift-grid">
            <thead>
              <tr>
                <th className="namecol">職員</th>
                {dayList.map((d) => {
                  const w = weekdayOf(yearMonth, d)
                  return (
                    <th key={d} className={w === 0 ? 'sun' : w === 6 ? 'sat' : ''}>
                      {d}
                      <br />
                      <span className="dow">{WEEKDAY_LABELS[w]}</span>
                    </th>
                  )
                })}
                {summaryPatterns.map((p) => (
                  <th key={p.id} className="sumcol">
                    {p.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="event-row">
                <td className="namecol">行事</td>
                {dayList.map((d) => {
                  const text = schedule?.events?.[String(d)] ?? ''
                  return (
                    <td
                      key={d}
                      className={isAdmin && !previewCandidate ? 'clickable' : undefined}
                      title={text || undefined}
                      onClick={(e) => {
                        if (!isAdmin || previewCandidate) return
                        setEventPicker({ day: d, rect: e.currentTarget.getBoundingClientRect() })
                      }}
                    >
                      {text}
                    </td>
                  )
                })}
                {summaryPatterns.map((p) => (
                  <td key={p.id} className="sumcol" />
                ))}
              </tr>
              {staffList.map((staff) => {
                const staffMsgs = checkResult.staffMessages[staff.id] ?? []
                const staffAssignments = effectiveAssignments[staff.id] ?? {}
                return (
                  <tr key={staff.id}>
                    <td className="namecol" title={staffMsgs.join('\n') || undefined}>
                      {staff.name}
                      {staffMsgs.length > 0 && <span className="warn"> ⚠</span>}
                    </td>
                    {dayList.map((d) => {
                      const patternId = staffAssignments[String(d)] ?? ''
                      const locked = !previewCandidate && (schedule?.locks?.[staff.id]?.[String(d)] ?? false)
                      const pattern = patternById.get(patternId)
                      const cellMsgs = checkResult.cellMessages[staff.id]?.[d] ?? []
                      const wish = wishDates.get(`${staff.id}_${formatDate(yearMonth, d)}`)
                      const wishBroken = !!wish && !!pattern?.isWork
                      const cellClass = [
                        'grid-cell',
                        cellMsgs.length > 0 ? 'viol' : '',
                        wish ? (wishBroken ? 'wish-bad' : 'wish-ok') : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      const title = cellMsgs.length > 0 ? cellMsgs.join('\n') : undefined
                      return (
                        <td key={d} className={cellClass} title={title}>
                          <div className="cell-wrap">
                            <div
                              className="cell-code"
                              style={
                                pattern
                                  ? { backgroundColor: pattern.color, color: pattern.textColor }
                                  : undefined
                              }
                              onClick={(e) => {
                                if (!isAdmin || previewCandidate) return
                                setPicker({
                                  staffId: staff.id,
                                  day: d,
                                  rect: e.currentTarget.getBoundingClientRect(),
                                })
                              }}
                            >
                              {pattern?.code ?? ''}
                            </div>
                            {locked && <span className="lock-dot" title="ロック中" />}
                            {cellMsgs.length > 0 && <span className="viol-mark">!</span>}
                          </div>
                        </td>
                      )
                    })}
                    {summaryPatterns.map((p) => {
                      const count = dayList.filter((d) => staffAssignments[String(d)] === p.id).length
                      return (
                        <td
                          key={p.id}
                          className="sumcol"
                          style={count && p.textColor ? { color: p.textColor, fontWeight: 700 } : undefined}
                        >
                          {count || ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {workPatterns.map((p) => (
                <tr key={p.id} className="tally-row">
                  <td className="namecol">{p.code} 計</td>
                  {dayList.map((d) => {
                    const need = demandFor(rules, yearMonth, d)[p.id]
                    const actual = actualCountFor(p.id, d)
                    if (need == null) {
                      const deficit = shiftGroupDeficitPatternIds(rules, yearMonth, d, (id) => actualCountFor(id, d))
                      return (
                        <td key={d} className={deficit.has(p.id) ? 'tally-short' : undefined}>
                          {actual}
                        </td>
                      )
                    }
                    return (
                      <td key={d} className={actual < need ? 'tally-short' : undefined}>
                        {actual}/{need}
                      </td>
                    )
                  })}
                  {summaryPatterns.map((sp) => (
                    <td key={sp.id} className="sumcol" />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picker &&
        !previewCandidate &&
        (() => {
          const pickerStaff = staffList.find((s) => s.id === picker.staffId)
          if (!pickerStaff) return null
          const locked = schedule?.locks?.[picker.staffId]?.[String(picker.day)] ?? false
          return (
            <CellPicker
              anchorRect={picker.rect}
              staffName={pickerStaff.name}
              dateLabel={formatMonthDayWeekday(yearMonth, picker.day)}
              options={optionsFor(pickerStaff)}
              current={schedule?.assignments?.[picker.staffId]?.[String(picker.day)] ?? ''}
              locked={locked}
              onPick={(patternId) => {
                void handleAssign(picker.staffId, picker.day, patternId)
                setPicker(null)
              }}
              onClear={() => {
                void handleAssign(picker.staffId, picker.day, '')
                setPicker(null)
              }}
              onToggleLock={() => {
                void handleToggleLock(picker.staffId, picker.day, locked)
                setPicker(null)
              }}
              onClose={() => setPicker(null)}
            />
          )
        })()}

      {eventPicker && (
        <EventPicker
          anchorRect={eventPicker.rect}
          dateLabel={formatMonthDayWeekday(yearMonth, eventPicker.day)}
          current={schedule?.events?.[String(eventPicker.day)] ?? ''}
          onSave={(text) => void handleSetEvent(eventPicker.day, text)}
          onClose={() => setEventPicker(null)}
        />
      )}

      {showLimitsModal && (
        <MonthlyLimitsModal
          yearMonth={yearMonth}
          daysInMonth={days}
          staffList={staffList}
          employmentTypes={employmentTypes}
          initialOverride={schedule?.monthlyMaxDaysOverride ?? {}}
          onSave={async (override) => {
            if (!selectedFacilityId || !user) return
            await saveMonthlyMaxDaysOverride(selectedFacilityId, yearMonth, days, override, user.uid)
            await load()
          }}
          onClose={() => setShowLimitsModal(false)}
        />
      )}

      {showTimeproModal && (
        <TimeproModal
          yearMonth={yearMonth}
          daysInMonth={days}
          staffList={staffList}
          shiftPatterns={shiftPatterns}
          assignments={effectiveAssignments}
          savedPatternMap={timeproPatternMap}
          isAdmin={isAdmin}
          onSave={async (patternMap) => {
            if (!selectedFacilityId) return
            await saveTimeproExportSettings(selectedFacilityId, { patternMap })
            setTimeproPatternMap(patternMap)
          }}
          onClose={() => setShowTimeproModal(false)}
        />
      )}

      <p className="muted no-print" style={{ marginTop: 10 }}>
        セルをクリックすると勤務パターンを選択できます。パネル内の「ロック切替」は自動生成でこのセルを固定する目印です（🔒が付きます）。
        「!」は必須条件・相性・勤務条件などの違反（マウスを乗せると詳細）、金の枠は希望休が守れている日、赤の枠は希望休なのに勤務が入っている日です。
      </p>

      {staffList.length > 0 && shiftPatterns.length > 0 && (
        <PrintableShiftGrid
          facilityName={facilityName}
          yearMonth={yearMonth}
          staffList={staffList}
          schedule={schedule}
          shiftPatterns={shiftPatterns}
          rules={rules}
        />
      )}
    </section>
  )
}
