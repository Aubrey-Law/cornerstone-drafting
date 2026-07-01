'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
import { saveLiDesignSheet, updatePlanCoverage } from '@/app/admin/matters/[id]/design/actions'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { DesignSheetImportProposal } from '@/lib/designSheetImport/shared'
import {
  buildInitialSheet,
  INTAKE_PREFILLED_FIELDS,
  normalizeOverrideValue,
} from './buildInitialSheet'

export type SaveStatus = 'saved' | 'dirty' | 'saving'

type ApiErrorResponse = { error?: string }
type SaveDesignSheetResponse = ApiErrorResponse & { id?: string }
type AddContactResponse = ApiErrorResponse & { contact?: MatterContact }

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

  const [sheet, setSheet] = useState<DesignSheet>(() => {
    const base = formatPhoneFieldsDeep(buildInitialSheet(sheetProp))
    if (!applyDefaults) return base
    return { ...base, ...computeDesignSheetDefaults(base, matter) }
  })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [_dirtyFields, setDirtyFields] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [contactsState, setContactsState] = useState(contactsProp)
  const [lpDataState, setLpDataState] = useState(lpDataProp)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Readiness ──────────────────────────────────────────────────────────────
  const readiness = useMemo(() => computeDesignSheetReadiness({
    sheet,
    matter,
    isLP,
    lpData: lpDataState,
  }), [isLP, lpDataState, matter, sheet])
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
    if (saveStatus === 'saving') return 'Saving...'
    if (saveStatus === 'dirty') return 'Unsaved changes'
    if (lastSavedAt) {
      return `Saved ${new Date(lastSavedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    }
    return 'All changes saved'
  }, [lastSavedAt, saveStatus])

  // ── Field updates with override tracking ─────────────────────────────────────
  const markDirty = useCallback((field: string) => {
    setDirtyFields(prev => new Set(prev).add(field))
    setSaveStatus('dirty')
  }, [])

  const updateField = useCallback(<K extends keyof DesignSheet>(field: K, value: DesignSheet[K]) => {
    setSheet(prev => {
      const fieldName = field as string
      const next = { ...prev, [field]: value }
      if (!INTAKE_PREFILLED_FIELDS.has(fieldName)) return next

      const previousOverrides = prev.overrides ?? {}
      const existing = previousOverrides[fieldName]
      const original = existing?.original ?? normalizeOverrideValue(prev[field])
      const updated = normalizeOverrideValue(value)
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
  }, [markDirty])

  // ── Persistence ──────────────────────────────────────────────────────────────
  const persistSheet = useCallback(async () => {
    setSaveStatus('saving')
    try {
      const persistedSheetId = sheetProp?.id || sheet.id
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetId: persistedSheetId || null, sheet: formatPhoneFieldsDeep(sheet) }),
      })
      const result = await response.json().catch(() => ({})) as SaveDesignSheetResponse
      if (!response.ok || !result.id) {
        throw new Error(result.error ?? 'Unable to save design sheet')
      }
      if (!persistedSheetId) {
        setSheet(prev => ({ ...prev, id: result.id as string, matter_id: matterId }))
      }
      setSaveStatus('saved')
      setDirtyFields(new Set())
      setLastSavedAt(new Date().toISOString())
      return true
    } catch (err) {
      console.error(err)
      setSaveStatus('dirty')
      toast.error('Unable to save design sheet')
      return false
    }
  }, [matterId, sheet, sheetProp?.id])

  const handleSave = useCallback(() => {
    startTransition(async () => { await persistSheet() })
  }, [persistSheet])

  // Auto-save: debounce 3 seconds after any field change
  useEffect(() => {
    if (saveStatus !== 'dirty') return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      startTransition(async () => { await persistSheet() })
    }, 3000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  // persistSheet captured via closure is stable; excluding to prevent infinite loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus])

  // Warn before unload when there are unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'dirty' || saveStatus === 'saving') e.preventDefault()
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
    setSheet(prev => ({ ...prev, ...patch } as DesignSheet))
    setSaveStatus('saved')
    setDirtyFields(new Set())
    setLastSavedAt(new Date().toISOString())
    router.refresh()
  }, [router])

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
    setSheet,
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
