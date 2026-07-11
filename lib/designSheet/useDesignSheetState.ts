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
import type { DesignSheetOnChange } from '@/app/admin/drafting/[matterId]/design/sections/shared'

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
 * DesignSheetShell and the streamlined ExpressDesignSheet) share identical save
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

  const hasLocalEditsRef = useRef(false)
  const [sheet, setSheet] = useState<DesignSheet>(() => {
    const resolved = resolveInitialDesignSheet({
      matterId,
      sheetProp,
      buildFromProps: () => {
        const base = formatPhoneFieldsDeep(buildInitialSheet(sheetProp))
        if (!applyDefaults) return base
        return { ...base, ...computeDesignSheetDefaults(base, matter) }
      },
    })
    // Session draft means the attorney already edited this matter in this tab.
    if (readDesignSheetDraft(matterId)) {
      hasLocalEditsRef.current = true
    }
    return resolved
  })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [_dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [contactsState, setContactsState] = useState(contactsProp)
  const [lpDataState, setLpDataState] = useState(lpDataProp)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(() => sheetProp?.updated_at ?? null)
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(() => sheetProp?.updated_at ?? null)
  const expectedUpdatedAtRef = useRef<string | null>(sheetProp?.updated_at ?? null)
  const serverSheetStampRef = useRef<string | null>(sheetProp?.updated_at ?? null)
  /** Last `sheetProp.updated_at` applied to local state — avoids clobbering edits after a local save when props are still stale. */
  const propsSheetStampRef = useRef<string | null>(sheetProp?.updated_at ?? null)
  const [saveRetryCount, setSaveRetryCount] = useState(0)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistInFlightRef = useRef(false)
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
    setSheet(previous => {
      const next = typeof updater === 'function'
        ? (updater as (previous: DesignSheet) => DesignSheet)(previous)
        : updater
      sheetRef.current = next
      writeDesignSheetDraft({
        matterId,
        sheet: next,
        baseUpdatedAt: serverSheetStampRef.current ?? expectedUpdatedAtRef.current,
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

  const sheetPropRef = useRef(sheetProp)
  sheetPropRef.current = sheetProp

  useEffect(() => {
    expectedUpdatedAtRef.current = expectedUpdatedAt
  }, [expectedUpdatedAt])

  // Keep local state aligned when the server component refreshes props (e.g. router.refresh).
  // Depend only on updated_at + saveStatus — not sheetProp identity — so drafting-workspace
  // parent re-renders cannot re-enter this effect and wipe local decisions.
  useEffect(() => {
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
    for (const item of readiness.blockers) {
      if (item.targetField) set.add(item.targetField)
    }
    return set
  }, [readiness.blockers])
  const validationValue = useMemo(
    () => ({ blockedFields, touched: touchedFields, markTouched }),
    [blockedFields, touchedFields, markTouched],
  )

  const sectionSummaries = readiness.sectionSummaries
  const blockerDetails = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; blockers: DesignReadinessBlocker[] }>()
    for (const item of readiness.blockers) {
      const current = grouped.get(item.sectionId)
      if (current) {
        current.blockers.push(item)
      } else {
        grouped.set(item.sectionId, { id: item.sectionId, label: item.sectionLabel, blockers: [item] })
      }
    }
    return Array.from(grouped.values())
  }, [readiness.blockers])
  const draftBlockers = useMemo(() => blockerDetails.map(b => b.label), [blockerDetails])

  const saveStatusText = useMemo(() => {
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
  }, [lastSavedAt, saveRetryCount, saveStatus])

  // ── Field updates with override tracking ─────────────────────────────────────
  const markDirty = useCallback((field: string) => {
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

  // ── Persistence ──────────────────────────────────────────────────────────────
  const persistSheet = useCallback(async (): Promise<boolean> => {
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
          const sheetForSave = prepareDesignSheetForSave(sheetRef.current)
          const response = await fetch(`/api/admin/matters/${matterId}/design-sheet`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sheetId: persistedSheetId || null,
              expectedUpdatedAt: expectedUpdatedAtRef.current,
              sheet: sheetForSave,
              // Authoritative decisions blob — API must not lose this to stale merges.
              decisions: sheetRef.current.decisions ?? {},
            }),
          })
          const result = await response.json().catch(() => ({})) as SaveDesignSheetResponse

          if (response.status === 409 || result.conflict) {
            const serverUpdatedAt = typeof result.updated_at === 'string' ? result.updated_at : null
            if (serverUpdatedAt) {
              expectedUpdatedAtRef.current = serverUpdatedAt
              setExpectedUpdatedAt(serverUpdatedAt)
              setLastSavedAt(serverUpdatedAt)
              serverSheetStampRef.current = serverUpdatedAt
            }
            // Another save likely landed first — retry with the server token before surfacing an error.
            if (serverUpdatedAt && attempt < maxAttempts - 1) continue
            hasLocalEditsRef.current = false
            finishPersist(generationAtSaveStart)
            toast.error('This design sheet was updated elsewhere. Reloading the latest version.')
            router.refresh()
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
          commitSheet(prev => stripDecisionOnlyTopLevelMirrors(
            prev as unknown as Record<string, unknown>,
          ) as unknown as DesignSheet)
          writeDesignSheetDraft({
            matterId,
            sheet: stripDecisionOnlyTopLevelMirrors(
              sheetRef.current as unknown as Record<string, unknown>,
            ) as unknown as DesignSheet,
            baseUpdatedAt: savedAt,
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
      if (pendingSaveRef.current && changeGenerationRef.current !== savedGenerationRef.current) {
        pendingSaveRef.current = false
        setSaveStatus('dirty')
      }
    }
  }, [commitSheet, finishPersist, flushSheetRef, matterId, router, sheetProp?.id])

  const handleSave = useCallback(() => {
    startTransition(async () => { await persistSheet() })
  }, [persistSheet])

  // Auto-save: debounce 3 seconds after any field change; retry after transient errors.
  useEffect(() => {
    if (saveStatus !== 'dirty' && saveStatus !== 'error') return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      startTransition(async () => { await persistSheet() })
    }, saveStatus === 'error' ? 5000 : 3000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  // persistSheet captured via closure is stable; excluding to prevent infinite loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus])

  // Warn before unload when there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'dirty' || saveStatus === 'saving' || saveStatus === 'error') e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveStatus])

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
    const nextData = formatPhoneFieldsDeep({ ...(lpDataState?.li_design_sheet_data ?? {}), ...patch })
    setLpDataState(prev => prev ? { ...prev, li_design_sheet_data: nextData } : prev)
    setSaveStatus('saving')
    startTransition(async () => {
      try {
        await saveLiDesignSheet(matterId, nextData)
        setSaveStatus('saved')
        setLastSavedAt(new Date().toISOString())
      } catch (err) {
        console.error(err)
        setSaveStatus('dirty')
      }
    })
  }, [matterId, lpDataState])

  const handlePlanCoverageChange = useCallback((coverage: 'no_trust' | 'trust_included') => {
    setLpDataState(prev => prev ? { ...prev, li_plan_coverage: coverage } : prev)
    startTransition(async () => {
      try {
        await updatePlanCoverage(matterId, coverage)
      } catch (err) {
        console.error(err)
        toast.error('Failed to update plan coverage')
      }
    })
  }, [matterId])

  // ── Import / Export ─────────────────────────────────────────────────────────
  const handleImportedDesignSheetFields = useCallback((patch: DesignSheetImportProposal) => {
    commitSheet(prev => ({ ...prev, ...patch } as DesignSheet))
    setSaveStatus('saved')
    setDirtyFields(new Set())
    setLastSavedAt(new Date().toISOString())
    router.refresh()
  }, [commitSheet, router])

  const handleExportDesignSheet = useCallback(async () => {
    setExporting(true)
    try {
      const saved = await persistSheet()
      if (!saved) return
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/export`)
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as ApiErrorResponse
        throw new Error(result.error ?? 'Unable to export design sheet')
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = disposition.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? 'design-sheet.docx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Design sheet exported')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to export design sheet'
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }, [matterId, persistSheet])

  return {
    isLP,
    sheet,
    setSheet: commitSheet,
    saveStatus,
    saveStatusText,
    lastSavedAt,
    isPending,
    exporting,
    // field editing
    updateField,
    validationValue,
    // persistence
    persistSheet,
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
    // readiness
    readiness,
    documentInclusions,
    sectionSummaries: sectionSummaries as Record<string, DesignSectionSummary>,
    blockerDetails,
    draftBlockers,
    readinessComplete: readiness.complete,
    readinessCompletedCount: readiness.completedCount,
    readinessTotal: readiness.total,
  }
}

export type DesignSheetState = ReturnType<typeof useDesignSheetState>
