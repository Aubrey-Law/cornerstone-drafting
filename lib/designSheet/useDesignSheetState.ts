'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { computeDesignSheetDefaults } from '@/lib/designSheetDefaults'
import {
  computeDesignSheetReadiness,
  type DesignReadinessBlocker,
  type DesignSectionSummary,
} from '@/lib/designSheetReadiness'
import { saveLiDesignSheet, updatePlanCoverage } from '@/app/admin/drafting/[matterId]/design/actions'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { DesignSheetImportProposal } from '@/lib/designSheetImport/shared'
import {
  buildInitialSheet,
  INTAKE_PREFILLED_FIELDS,
  normalizeOverrideValue,
} from './buildInitialSheet'
import { shouldApplyServerSheetProps } from '@/lib/designSheet/shouldApplyServerSheetProps'
import {
  prepareDesignSheetForSave,
  readDesignSheetDraft,
  resolveInitialDesignSheet,
  writeDesignSheetDraft,
} from '@/lib/designSheet/designSheetDraft'
import { stripDecisionOnlyTopLevelMirrors } from '@/lib/designSheetPersistence'
import {
  applyDecisionFieldValues,
  isDesignSheetDecisionField,
} from '@/lib/designSheetImport/decisionFields'
import type { DesignSheetOnChange } from '@/app/admin/drafting/[matterId]/design/sections/shared'

import { resolveDesignSheetConflict, type ConflictChoices, type DesignSheetConflict } from './designSheetConflict'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

type ApiErrorResponse = { error?: string }
type SaveDesignSheetResponse = ApiErrorResponse & { id?: string; updated_at?: string; version?: number; conflict?: boolean }
type AddContactResponse = ApiErrorResponse & { contact?: MatterContact }

const READINESS_DEBOUNCE_MS = 300

export interface LpData {
  li_plan_coverage: string
  li_design_sheet_data: Record<string, unknown>
  li_design_sheet_approved: boolean
}

export interface UseDesignSheetStateArgs {
  matterId: string
  matter: PipelineMatter
  contacts: MatterContact[]
  sheet: DesignSheet | null
  lpData: LpData | null
  /** Apply computeDesignSheetDefaults to pre-fill blanks on first load (Express). */
  applyDefaults?: boolean
}

/**
 * Encapsulates all design-sheet editing state, autosave, contact management and
 * readiness computation. Extracted so multiple shells (the guided
 * Embedded and standalone single-page sheets share identical save
 * and validation behaviour without duplicating logic.
 */
export function useDesignSheetState({
  matterId,
  matter,
  contacts: contactsProp,
  sheet: sheetProp,
  lpData: lpDataProp,
  applyDefaults = false,
}: UseDesignSheetStateArgs) {
  const router = useRouter()
  const isLP = normalizePracticeArea(matter.practice_area) === 'EP-LP'

  // Session draft means the attorney already edited this matter in this tab.
  const [initialDraft] = useState(() => readDesignSheetDraft(matterId))
  const initialDraftExists = Boolean(initialDraft)
  const baseSheetRef = useRef<DesignSheet | null>(initialDraft?.baseSheet ?? sheetProp)
  const [conflict, setConflict] = useState<DesignSheetConflict | null>(() => initialDraft?.conflict ?? (initialDraft && initialDraft.baseUpdatedAt !== (sheetProp?.updated_at ?? null) ? { local: initialDraft.sheet, base: initialDraft.baseSheet ?? null, latest: sheetProp } : null))
  const conflictRef = useRef(conflict)
  const recoveryReadVersionRef = useRef(0)
  useEffect(() => () => { recoveryReadVersionRef.current += 1 }, [])
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const hasLocalEditsRef = useRef(initialDraftExists)
  const [sheet, setSheet] = useState<DesignSheet>(() => resolveInitialDesignSheet({
    matterId,
    sheetProp,
    buildFromProps: () => {
      const base = formatPhoneFieldsDeep(buildInitialSheet(sheetProp))
      if (!applyDefaults) return base
      return { ...base, ...computeDesignSheetDefaults(base, matter) }
    },
  }))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(conflict ? 'error' : initialDraftExists ? 'dirty' : 'saved')
  const [_dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [contactsState, setContactsState] = useState(contactsProp)
  const [lpDataState, setLpDataState] = useState(lpDataProp)
  const lpDataRef = useRef(lpDataProp)
  const auxiliaryQueueRef = useRef<Promise<void>>(Promise.resolve())
  const failedAuxiliaryRef = useRef(new Map<string, () => Promise<unknown>>())
  const auxiliaryPendingRef = useRef(0)
  const [auxiliaryStatus, setAuxiliaryStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(() => sheetProp?.updated_at ?? null)
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(() => sheetProp?.updated_at ?? null)
  const expectedUpdatedAtRef = useRef<string | null>(sheetProp?.updated_at ?? null)
  const serverSheetStampRef = useRef<string | null>(sheetProp?.updated_at ?? null)
  /** Last `sheetProp.updated_at` applied to local state — avoids clobbering edits after a local save when props are still stale. */
  const propsSheetStampRef = useRef<string | null>(sheetProp?.updated_at ?? null)
  const [saveRetryCount, setSaveRetryCount] = useState(0)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistInFlightRef = useRef(false)
  const persistPromiseRef = useRef<Promise<boolean> | null>(null)
  const pendingSaveRef = useRef(false)
  const sheetRef = useRef(sheet)
  const changeGenerationRef = useRef(0)
  const savedGenerationRef = useRef(0)
  const [exporting, setExporting] = useState(false)
  const [readinessSheet, setReadinessSheet] = useState(sheet)

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

  /** Apply sheet state and keep sheetRef in sync immediately (not after useEffect). */
  const commitSheet = useCallback((
    updater: DesignSheet | ((previous: DesignSheet) => DesignSheet),
  ) => {
    if (conflictRef.current) return
    setSheet(previous => {
      const next = typeof updater === 'function'
        ? (updater as (previous: DesignSheet) => DesignSheet)(previous)
        : updater
      sheetRef.current = next
      writeDesignSheetDraft({
        matterId,
        sheet: next,
        baseUpdatedAt: serverSheetStampRef.current ?? expectedUpdatedAtRef.current,
        baseSheet: baseSheetRef.current,
      })
      return next
    })
  }, [matterId])

  /** Wait for any in-flight React sheet updates before reading sheetRef for persistence. */
  const flushSheetRef = useCallback((): Promise<void> => {
    return new Promise(resolve => {
      flushSync(() => {
        commitSheet(current => current)
      })
      resolve()
    })
  }, [commitSheet])

  useEffect(() => {
    sheetRef.current = sheet
  }, [sheet])

  // Latest sheetProp for the server-refresh effect below; synced in an effect
  // declared first so it runs before any consumer in the same commit.
  const sheetPropRef = useRef(sheetProp)
  useEffect(() => {
    sheetPropRef.current = sheetProp
  }, [sheetProp])

  useEffect(() => {
    expectedUpdatedAtRef.current = expectedUpdatedAt
  }, [expectedUpdatedAt])

  // Keep local state aligned when the server component refreshes props (e.g. router.refresh).
  // Depend only on updated_at + saveStatus — not sheetProp identity — so drafting-workspace
  // parent re-renders cannot re-enter this effect and wipe local decisions.
  useEffect(() => {
    if (conflictRef.current) return
    const stamp = sheetProp?.updated_at ?? null
    const decision = shouldApplyServerSheetProps({
      stamp,
      propsSheetStamp: propsSheetStampRef.current,
      serverSheetStamp: serverSheetStampRef.current,
      saveStatus,
      hasLocalEdits: hasLocalEditsRef.current,
    })
    if (decision.action === 'ignore' || !stamp) return

    if (decision.action === 'acknowledge') {
      propsSheetStampRef.current = stamp
      return
    }

    propsSheetStampRef.current = stamp
    serverSheetStampRef.current = stamp
    const base = formatPhoneFieldsDeep(buildInitialSheet(sheetPropRef.current))
    const nextSheet = applyDefaults
      ? { ...base, ...computeDesignSheetDefaults(base, matter) }
      : base
    baseSheetRef.current = nextSheet
    commitSheet(nextSheet)
    setReadinessSheet(nextSheet)
    expectedUpdatedAtRef.current = stamp
    setExpectedUpdatedAt(stamp)
    setLastSavedAt(stamp)
    setSaveStatus('saved')
    setDirtyFields(new Set())
  }, [applyDefaults, commitSheet, matter, saveStatus, sheetProp?.updated_at])

  // Debounce readiness so the summary rail does not recompute on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setReadinessSheet(sheet), READINESS_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [sheet])

  // ── Readiness ──────────────────────────────────────────────────────────────
  const readiness = useMemo(() => computeDesignSheetReadiness({
    sheet: readinessSheet,
    matter,
    isLP,
    lpData: lpDataState,
  }), [isLP, lpDataState, matter, readinessSheet])
  const documentInclusions = readiness.documentInclusions

  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set())
  const markTouched = useCallback((field: string) => {
    setTouchedFields(prev => {
      if (prev.has(field)) return prev
      const next = new Set(prev)
      next.add(field)
      return next
    })
  }, [])
  const blockedFields = useMemo(() => {
    const set = new Set<string>()
    for (const item of readiness.blocking) {
      if (item.targetField) set.add(item.targetField)
    }
    return set
  }, [readiness.blocking])
  const validationValue = useMemo(
    () => ({ blockedFields, touched: touchedFields, markTouched }),
    [blockedFields, touchedFields, markTouched],
  )

  const sectionSummaries = readiness.sectionSummaries
  const groupReadinessItems = useCallback((items: DesignReadinessBlocker[]) => {
    const grouped = new Map<string, { id: string; label: string; blockers: DesignReadinessBlocker[] }>()
    for (const item of items) {
      const current = grouped.get(item.sectionId)
      if (current) {
        current.blockers.push(item)
      } else {
        grouped.set(item.sectionId, { id: item.sectionId, label: item.sectionLabel, blockers: [item] })
      }
    }
    return Array.from(grouped.values())
  }, [])
  const blockingDetails = useMemo(
    () => groupReadinessItems(readiness.blocking),
    [groupReadinessItems, readiness.blocking],
  )
  const optionalDetails = useMemo(
    () => groupReadinessItems(readiness.optional),
    [groupReadinessItems, readiness.optional],
  )
  const draftBlockers = useMemo(() => blockingDetails.map(b => b.label), [blockingDetails])

  const saveStatusText = useMemo(() => {
    if (conflict) return 'Unsaved changes — resolve conflicting versions'
    if (auxiliaryStatus === 'error') return 'Plan changes could not be saved. Retry saving before drafting.'
    if (auxiliaryStatus === 'saving') return 'Saving plan changes…'
    if (saveStatus === 'saving') return saveRetryCount > 0 ? `Retrying save (${saveRetryCount})…` : 'Saving…'
    if (saveStatus === 'error') return 'Save failed — will retry'
    if (saveStatus === 'dirty') return 'Unsaved changes'
    if (lastSavedAt) {
      const when = new Date(lastSavedAt)
      const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      const date = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const today = new Date().toDateString() === when.toDateString()
      return today ? `Saved at ${time}` : `Saved ${date} ${time}`
    }
    return 'All changes saved'
  }, [auxiliaryStatus, conflict, lastSavedAt, saveRetryCount, saveStatus])

  // ── Field updates with override tracking ─────────────────────────────────────
  const markDirty = useCallback((field: string) => {
    if (conflictRef.current) return
    hasLocalEditsRef.current = true
    changeGenerationRef.current += 1
    setDirtyFields(prev => new Set(prev).add(field))
    setSaveStatus('dirty')
  }, [])

  const finishPersist = useCallback((generationAtSaveStart: number) => {
    const hasUnsavedChanges = changeGenerationRef.current !== generationAtSaveStart
    if (hasUnsavedChanges || pendingSaveRef.current) {
      pendingSaveRef.current = false
      setSaveStatus('dirty')
      return
    }
    savedGenerationRef.current = generationAtSaveStart
    setSaveStatus('saved')
    setSaveRetryCount(0)
    setDirtyFields(new Set())
  }, [])

  const updateField = useCallback<DesignSheetOnChange>((
    field,
    value,
  ) => {
    commitSheet(prev => {
      const fieldName = field as string
      const resolved = typeof value === 'function'
        ? value(prev)
        : value
      const next = { ...prev, [field]: resolved }
      if (!INTAKE_PREFILLED_FIELDS.has(fieldName)) return next

      const previousOverrides = prev.overrides ?? {}
      const existing = previousOverrides[fieldName]
      const original = existing?.original ?? normalizeOverrideValue(prev[field])
      const updated = normalizeOverrideValue(resolved)
      const overrides = { ...previousOverrides }

      if (updated === original) {
        delete overrides[fieldName]
      } else {
        overrides[fieldName] = {
          original,
          updated_by: existing?.updated_by ?? 'attorney',
        }
      }

      return { ...next, overrides }
    })
    markDirty(field as string)
  }, [commitSheet, markDirty])

  const storeConflict = useCallback((value: DesignSheetConflict) => {
    recoveryReadVersionRef.current += 1
    conflictRef.current = value
    setConflict(value)
    pendingSaveRef.current = false
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    setSaveStatus('error')
    writeDesignSheetDraft({ matterId, sheet: value.local, baseSheet: value.base, baseUpdatedAt: expectedUpdatedAtRef.current, conflict: value })
  }, [matterId])

  const loadConflictLatest = useCallback(async (recovery?: DesignSheetConflict) => {
    if (!recovery && persistInFlightRef.current) return
    const current = recovery ?? conflictRef.current
    if (!current) return
    storeConflict(current)
    const readVersion = recoveryReadVersionRef.current
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet`, { cache: 'no-store' })
      const result = await response.json()
      if (readVersion !== recoveryReadVersionRef.current) return
      if (!response.ok || !result.sheet?.updated_at) throw new Error('Unable to load the latest saved version.')
      storeConflict({ ...current, latest: result.sheet, error: undefined })
    } catch {
      if (readVersion !== recoveryReadVersionRef.current) return
      storeConflict({ ...current, error: 'Unable to load the latest saved version. Your changes are preserved. Try again.' })
    }
  }, [matterId, storeConflict])

  const resolveConflict = useCallback(async (choices: ConflictChoices): Promise<boolean> => {
    const recovery = conflictRef.current
    if (!recovery?.latest || persistInFlightRef.current) return false
    let resolved: DesignSheet
    try { resolved = resolveDesignSheetConflict(recovery.local, recovery.latest, choices) }
    catch (error) { storeConflict({ ...recovery, error: (error as Error).message }); return false }
    // Any pending GET describes the pre-resolution recovery state. It must not
    // replace this operation or resurrect recovery after its successful save.
    recoveryReadVersionRef.current += 1
    persistInFlightRef.current = true
    setResolvingConflict(true)
    try {
      const prepared = prepareDesignSheetForSave(resolved)
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: recovery.latest.id, expectedUpdatedAt: recovery.latest.updated_at, sheet: prepared, decisions: prepared.decisions }),
      })
      const result = await response.json().catch(() => ({})) as SaveDesignSheetResponse
      if (response.status === 409 || result.conflict) {
        await loadConflictLatest(recovery)
        return false
      }
      if (!response.ok || !result.id) throw new Error(result.error ?? 'Unable to save resolved changes.')
      const stamp = result.updated_at ?? recovery.latest.updated_at
      const saved = { ...resolved, id: result.id, updated_at: stamp }
      recoveryReadVersionRef.current += 1
      conflictRef.current = null
      setConflict(null)
      sheetRef.current = saved
      setSheet(saved)
      baseSheetRef.current = saved
      expectedUpdatedAtRef.current = stamp ?? null
      serverSheetStampRef.current = stamp ?? null
      setExpectedUpdatedAt(stamp ?? null)
      setLastSavedAt(stamp ?? null)
      pendingSaveRef.current = false
      finishPersist(changeGenerationRef.current)
      writeDesignSheetDraft({ matterId, sheet: saved, baseUpdatedAt: stamp ?? null, baseSheet: saved })
      return true
    } catch {
      storeConflict({ ...recovery, error: 'Unable to save resolved changes. Both versions are preserved. Try again.' })
      return false
    } finally {
      persistInFlightRef.current = false
      setResolvingConflict(false)
    }
  }, [finishPersist, loadConflictLatest, matterId, storeConflict])

  // ── Persistence ──────────────────────────────────────────────────────────────
  const performPersist = useCallback(async (): Promise<boolean> => {
    if (conflictRef.current) return false
    if (persistInFlightRef.current) {
      pendingSaveRef.current = true
      return false
    }
    persistInFlightRef.current = true
    setSaveStatus('saving')
    const generationAtSaveStart = changeGenerationRef.current
    const maxAttempts = 3
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          setSaveRetryCount(attempt)
          await sleep(1000 * 2 ** (attempt - 1))
        }
        try {
          await flushSheetRef()
          const persistedSheetId = sheetProp?.id || sheetRef.current.id
          const savingSnapshot = sheetRef.current
          const sheetForSave = prepareDesignSheetForSave(savingSnapshot)
          const response = await fetch(`/api/admin/matters/${matterId}/design-sheet`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sheetId: persistedSheetId || null,
              expectedUpdatedAt: expectedUpdatedAtRef.current,
              sheet: sheetForSave,
              // Authoritative decisions blob — API must not lose this to stale merges.
              // The live blob alone is not enough: fields without a dedicated column
              // (bond, supervision, HCP/DPOA choices…) are edited on the sheet
              // top-level, and only the prepared payload folds them back in. Layer it
              // over the live blob so those edits ship without dropping keys the
              // payload builder moves to columns.
              decisions: {
                ...(sheetRef.current.decisions ?? {}),
                ...((sheetForSave.decisions as Record<string, unknown> | undefined) ?? {}),
              },
            }),
          })
          const result = await response.json().catch(() => ({})) as SaveDesignSheetResponse

          if (response.status === 409 || result.conflict) {
            await loadConflictLatest({ local: sheetRef.current, base: baseSheetRef.current, latest: null })
            return false
          }

          if (!response.ok || !result.id) {
            throw new Error(result.error ?? 'Unable to save design sheet')
          }

          if (!persistedSheetId) {
            commitSheet(prev => ({ ...prev, id: result.id as string, matter_id: matterId }))
          }
          const savedAt = result.updated_at ?? new Date().toISOString()
          expectedUpdatedAtRef.current = savedAt
          setExpectedUpdatedAt(savedAt)
          setLastSavedAt(savedAt)
          // Advance the local-save watermark only. Do NOT move propsSheetStampRef here —
          // sheetProp still has the pre-save updated_at until RSC refreshes, and matching
          // propsSheetStampRef to savedAt would make the sync effect treat those stale
          // props as "new" when saveStatus flips to saved.
          serverSheetStampRef.current = savedAt
          baseSheetRef.current = { ...savingSnapshot, updated_at: savedAt }
          commitSheet(prev => stripDecisionOnlyTopLevelMirrors(
            prev as unknown as Record<string, unknown>,
          ) as unknown as DesignSheet)
          writeDesignSheetDraft({
            matterId,
            sheet: stripDecisionOnlyTopLevelMirrors(
              sheetRef.current as unknown as Record<string, unknown>,
            ) as unknown as DesignSheet,
            baseUpdatedAt: savedAt,
            baseSheet: baseSheetRef.current,
          })
          finishPersist(generationAtSaveStart)
          return true
        } catch (err) {
          if (attempt === maxAttempts - 1) throw err
        }
      }
      return false
    } catch (err) {
      console.error(err)
      setSaveStatus('error')
      const detail = err instanceof Error && err.message ? err.message : null
      toast.error(
        detail && detail !== 'Unable to save design sheet'
          ? `Unable to save design sheet after several attempts: ${detail}`
          : 'Unable to save design sheet after several attempts',
      )
      return false
    } finally {
      persistInFlightRef.current = false
      if (!conflictRef.current && pendingSaveRef.current && changeGenerationRef.current !== savedGenerationRef.current) {
        pendingSaveRef.current = false
        setSaveStatus('dirty')
      }
    }
  }, [commitSheet, finishPersist, flushSheetRef, loadConflictLatest, matterId, sheetProp?.id])

  // All callers share the active save. The drafting barrier additionally drains
  // edits made during that request before it allows preflight to read the server.
  const persistSheet = useCallback((): Promise<boolean> => {
    if (persistPromiseRef.current) return persistPromiseRef.current
    const promise = performPersist().finally(() => { persistPromiseRef.current = null })
    persistPromiseRef.current = promise
    return promise
  }, [performPersist])

  const queueAuxiliarySave = useCallback((key: string, save: () => Promise<unknown>) => {
    auxiliaryPendingRef.current += 1
    setAuxiliaryStatus('saving')
    auxiliaryQueueRef.current = auxiliaryQueueRef.current.then(async () => {
      try {
        await save()
        failedAuxiliaryRef.current.delete(key)
        setLastSavedAt(new Date().toISOString())
      } catch {
        failedAuxiliaryRef.current.set(key, save)
      } finally {
        auxiliaryPendingRef.current -= 1
        setAuxiliaryStatus(auxiliaryPendingRef.current ? 'saving' : failedAuxiliaryRef.current.size ? 'error' : 'saved')
      }
    })
  }, [])

  const flushAndSave = useCallback(async (): Promise<boolean> => {
    await flushSheetRef()
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    if (conflictRef.current) return false
    // LP design and coverage use separate actions. Include their queued writes,
    // and retry retained failures, before preflight reads either source.
    // Let newer queued patches settle before deciding what failed. Otherwise
    // retrying an older failed snapshot behind a newer patch can overwrite it.
    do { await auxiliaryQueueRef.current } while (auxiliaryPendingRef.current)
    for (const [key, save] of failedAuxiliaryRef.current) queueAuxiliarySave(key, save)
    while (true) {
      do { await auxiliaryQueueRef.current } while (auxiliaryPendingRef.current)
      if (conflictRef.current || failedAuxiliaryRef.current.size) return false
      if (persistPromiseRef.current && !(await persistPromiseRef.current)) return false
      await flushSheetRef()
      if (!sheetRef.current.id || changeGenerationRef.current !== savedGenerationRef.current) {
        if (!(await persistSheet())) return false
        continue
      }
      if (auxiliaryPendingRef.current) continue
      return !conflictRef.current && !failedAuxiliaryRef.current.size
    }
  }, [flushSheetRef, persistSheet, queueAuxiliarySave])

  const handleSave = useCallback(() => {
    startTransition(async () => { await persistSheet() })
  }, [persistSheet])

  // Auto-save: debounce 3 seconds after any field change; retry after transient errors.
  useEffect(() => {
    if (conflictRef.current || (saveStatus !== 'dirty' && saveStatus !== 'error')) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      startTransition(async () => { await persistSheet() })
    }, saveStatus === 'error' ? 5000 : 3000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  // persistSheet captured via closure is stable; excluding to prevent infinite loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus, conflict])

  // Warn before unload when there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatus !== 'saved' || auxiliaryStatus !== 'saved') e.preventDefault()
    }
    const navigate = (event: MouseEvent) => {
      if (saveStatus === 'saved' && auxiliaryStatus === 'saved') return
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const destination = new URL(link.href, window.location.href)
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return
      event.preventDefault()
      event.stopPropagation()
      toast.error('Save or resolve your design sheet changes before leaving this page.')
    }
    window.addEventListener('beforeunload', handler)
    document.addEventListener('click', navigate, true)
    return () => {
      window.removeEventListener('beforeunload', handler)
      document.removeEventListener('click', navigate, true)
    }
  }, [auxiliaryStatus, saveStatus])

  // ── Contacts ──────────────────────────────────────────────────────────────────
  const handleAddContact = useCallback(async (data: Omit<MatterContact, 'id'>) => {
    const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await response.json().catch(() => ({})) as AddContactResponse
    if (!response.ok || !result.contact) {
      throw new Error(result.error ?? 'Failed to add contact')
    }
    const contact = result.contact
    setContactsState(prev => [...prev, contact])
    return contact
  }, [matterId])

  const handleUpdateContact = useCallback(async (id: string, data: Omit<MatterContact, 'id'>) => {
    const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/contacts`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...data }),
    })
    const result = await response.json().catch(() => ({})) as AddContactResponse
    if (!response.ok || !result.contact) {
      throw new Error(result.error ?? 'Failed to update contact')
    }
    const contact = result.contact
    setContactsState(prev => prev.map(existing => (existing.id === id ? contact : existing)))
    return contact
  }, [matterId])

  const handleRemoveContact = useCallback((id: string) => {
    setContactsState(prev => prev.filter(contact => contact.id !== id))
  }, [])

  // ── LP-specific data ──────────────────────────────────────────────────────────
  const updateLpPatch = useCallback((patch: Record<string, unknown>) => {
    if (conflictRef.current) return
    const previousData = lpDataRef.current?.li_design_sheet_data ?? {}
    const nextData = formatPhoneFieldsDeep({ ...previousData, ...patch })
    if (lpDataRef.current) lpDataRef.current = { ...lpDataRef.current, li_design_sheet_data: nextData }
    setLpDataState(lpDataRef.current)
    queueAuxiliarySave('design', () => saveLiDesignSheet(matterId, nextData))
  }, [matterId, queueAuxiliarySave])

  const handlePlanCoverageChange = useCallback((coverage: 'no_trust' | 'trust_included') => {
    if (conflictRef.current) return
    if (lpDataRef.current) lpDataRef.current = { ...lpDataRef.current, li_plan_coverage: coverage }
    setLpDataState(lpDataRef.current)
    queueAuxiliarySave('coverage', () => updatePlanCoverage(matterId, coverage))
  }, [matterId, queueAuxiliarySave])

  // ── Import / Export ─────────────────────────────────────────────────────────
  /**
   * Apply a "copy plan structure" patch (see lib/designSheet/planStructureClone)
   * through the normal field-update path so override tracking, dirty state and
   * autosave all behave as if the attorney typed the values. `decisions` merges
   * key-by-key so matter-specific decisions (deed, funding plan, exclusions)
   * are preserved.
   */
  const applyPlanStructurePatch = useCallback((patch: Partial<DesignSheet>) => {
    const { decisions: patchDecisions, ...rest } = patch
    for (const [field, value] of Object.entries(rest)) {
      updateField(field as keyof DesignSheet, value as never)
    }
    if (patchDecisions && typeof patchDecisions === 'object') {
      updateField('decisions', previous => ({
        ...(previous.decisions && typeof previous.decisions === 'object' ? previous.decisions : {}),
        ...(patchDecisions as Record<string, unknown>),
      }))
    }
  }, [updateField])

  /**
   * Mirror an accepted proposal into local state. The server has already saved it
   * (apply-proposal), so this only keeps the open workspace from showing stale
   * values until the refreshed props arrive.
   *
   * Decision fields are routed by namespace rather than dropped at the top level:
   * a `<namespace>.<key>` name set directly on the sheet object would be read back
   * by nothing, which is exactly the bug the qualified names were introduced to fix.
   */
  const handleImportedDesignSheetFields = useCallback((
    patch: DesignSheetImportProposal,
    fiduciaryCount = 0,
  ) => {
    if (conflictRef.current) return
    commitSheet(prev => {
      const columnFields: Record<string, unknown> = {}
      const decisionFields: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(patch as Record<string, unknown>)) {
        if (isDesignSheetDecisionField(field)) decisionFields[field] = value
        else columnFields[field] = value
      }

      const next = { ...prev, ...columnFields } as DesignSheet
      if (Object.keys(decisionFields).length === 0) return next
      return { ...next, decisions: applyDecisionFieldValues(next, decisionFields) }
    })
    setSaveStatus('saved')
    setDirtyFields(new Set())
    setLastSavedAt(new Date().toISOString())
    // Accepted fiduciaries changed contacts and slot arrays server-side; the
    // refreshed props are the only source for those.
    void fiduciaryCount
    router.refresh()
  }, [commitSheet, router])

  const exportDesignSheet = useCallback(async (format?: 'json' | 'json-docx' | 'statular' | 'summary') => {
    setExporting(true)
    try {
      const saved = await persistSheet()
      if (!saved) return
      const query = format ? `?format=${format}` : ''
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/export${query}`)
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as ApiErrorResponse
        throw new Error(result.error ?? 'Unable to export design sheet')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename="([^"]+)"/)
      const fallbackName = format === 'json'
        ? 'generator-data.json'
        : format === 'statular' ? 'statular-import.md'
        : format === 'summary' ? 'internal-design-summary.docx' : 'design-sheet.docx'
      const filename = filenameMatch?.[1] ?? fallbackName
      // json-docx also falls back to .docx above, which matches its payload.
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success(
        format === 'statular' ? 'Statular import file exported'
          : format === 'summary' ? 'Internal design summary exported'
          : format ? 'Generator data exported'
          : 'Design sheet exported',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to export design sheet'
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }, [matterId, persistSheet])

  const handleExportDesignSheet = useCallback(() => exportDesignSheet(), [exportDesignSheet])
  const handleExportGeneratorData = useCallback(() => exportDesignSheet('json'), [exportDesignSheet])
  // The Word-wrapped variant exists because Mike's uploads only accept office
  // file types; the body is the same JSON, ready to attach to a Mike chat.
  const handleExportGeneratorDataDocx = useCallback(() => exportDesignSheet('json-docx'), [exportDesignSheet])
  // Statular ingests uploaded files and extracts from them, so the export is
  // Markdown in its own question wording rather than our generator paths.
  const handleExportStatular = useCallback(() => exportDesignSheet('statular'), [exportDesignSheet])

  const handleExportSummary = useCallback(() => exportDesignSheet('summary'), [exportDesignSheet])

  return {
    isLP,
    conflict,
    resolvingConflict,
    resolveConflict,
    reloadConflictLatest: loadConflictLatest,
    sheet,
    setSheet: commitSheet,
    saveStatus: auxiliaryStatus !== 'saved' ? auxiliaryStatus : saveStatus,
    saveStatusText,
    lastSavedAt,
    isPending,
    exporting,
    // field editing
    updateField,
    validationValue,
    // persistence
    persistSheet,
    flushAndSave,
    handleSave,
    // contacts
    contactsState,
    handleAddContact,
    handleUpdateContact,
    handleRemoveContact,
    // lp
    lpDataState,
    setLpDataState,
    updateLpPatch,
    handlePlanCoverageChange,
    // import/export
    handleImportedDesignSheetFields,
    handleExportDesignSheet,
    handleExportGeneratorData,
    handleExportGeneratorDataDocx,
    handleExportStatular,
    handleExportSummary,
    applyPlanStructurePatch,
    // readiness
    readiness,
    documentInclusions,
    sectionSummaries: sectionSummaries as Record<string, DesignSectionSummary>,
    blockingCount: readiness.blocking.length,
    optionalCount: readiness.optional.length,
    blockingDetails,
    optionalDetails,
    draftBlockers,
    readinessComplete: readiness.complete,
    readinessCompletedCount: readiness.completedCount,
    readinessTotal: readiness.total,
  }
}

export type DesignSheetState = ReturnType<typeof useDesignSheetState>
