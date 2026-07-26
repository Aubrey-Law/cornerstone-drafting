'use client'

import { useMemo, useState, useEffect, useLayoutEffect, useRef, useCallback, useTransition, type UIEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import '@/app/intake/guided.css'
import { designFieldTargetId, type DesignSectionSummary } from '@/lib/designSheetReadiness'
import { shouldApplyDesignInitialFocus, type DesignInitialFocus } from '@/lib/designFocusNavigation'
import { cn } from '@/lib/utils'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import {
  type DesignDocumentInclusions,
  type DesignDocumentKey,
} from '@/lib/designSheetDocumentInclusions'
import { useDesignSheetState, type DesignSheetState } from '@/lib/designSheet/useDesignSheetState'
import {
  BrandBar,
  DesignSummaryRail,
  DesignToolbarActions,
  guidedEmbeddedPageStyle,
  guidedPageStyle,
  type GuidedSaveStatus,
} from '@/components/guided'
import { Button } from '@/components/ui/button'
import { DesignValidationProvider } from './sections/shared'
import { SharedFieldsProvider } from '@/components/sharedFields/provider'
import {
  buildDesignSectionDefs,
  buildSummarySectionItems,
  designOverviewHref,
  designSectionHref,
  resolveDesignSectionId,
  visibleDesignSections,
} from './designSectionCatalog'
import { DesignSectionOverview } from './DesignSectionOverview'
import { DesignSectionPageView } from './DesignSectionPageView'
import { DesignAccelerationBar } from '@/components/design-sheet/DesignAccelerationBar'
import { DesignFinalReview } from '@/components/design-sheet/DesignFinalReview'
import { findNextUnresolvedBlocker, groupGuidedSections } from '@/lib/designSheet/guidedNavigation'
import { useUserPreferences } from '@/lib/userPreferencesClient'
import type { AttorneyDesignPreset } from '@/lib/designSheet/fastEntryWorkflow'
import type { PipelineMatter, DesignSheet, MatterContact } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

const ClonePlanDialog = dynamic(
  () => import('@/components/design-sheet/ClonePlanDialog').then(m => ({ default: m.ClonePlanDialog })),
  { ssr: false },
)

const DesignSheetImportDialog = dynamic(
  () => import('@/components/design-sheet/DesignSheetImportDialog').then(m => ({ default: m.DesignSheetImportDialog })),
  { ssr: false },
)

interface DesignSheetShellProps {
  matterId: string
  matter: PipelineMatter
  contacts: MatterContact[]
  sheet: DesignSheet | null
  lpData: {
    li_plan_coverage: string
    li_design_sheet_data: Record<string, unknown>
    li_design_sheet_approved: boolean
  } | null
  intakeSnapshot: IntakeSnapshot | null
  embedded?: boolean
  onOpenDrafting?: () => void
  /** When null, show the section overview. Otherwise show that section as its own page. */
  activeSectionId?: string | null
  initialFocus?: { sectionId: string; targetField: string | null } | null
  /**
   * Parent-owned design sheet state (drafting workspace). When set, this shell does not
   * create its own autosave hook — so Guided/Express switches keep edits.
   */
  designState?: DesignSheetState
}

function mapSaveStatus(status: 'saved' | 'dirty' | 'saving' | 'error'): GuidedSaveStatus {
  return status
}

export default function DesignSheetShell(props: DesignSheetShellProps) {
  if (props.designState) {
    return <DesignSheetShellImpl {...props} s={props.designState} />
  }
  return <DesignSheetShellWithHook {...props} />
}

function DesignSheetShellWithHook(props: DesignSheetShellProps) {
  const s = useDesignSheetState({
    matterId: props.matterId,
    matter: props.matter,
    contacts: props.contacts,
    sheet: props.sheet,
    lpData: props.lpData,
  })
  return <DesignSheetShellImpl {...props} s={s} />
}

function DesignSheetShellImpl({
  matterId,
  matter,
  intakeSnapshot,
  embedded = false,
  onOpenDrafting,
  activeSectionId = null,
  initialFocus = null,
  s,
}: DesignSheetShellProps & { s: DesignSheetState }) {
  const router = useRouter()
  const [, startNavigation] = useTransition()
  const {
    isLP,
    sheet,
    saveStatus,
    saveStatusText,
    isPending,
    exporting,
    updateField,
    validationValue,
    handleSave,
    contactsState,
    handleAddContact,
    handleUpdateContact,
    handleRemoveContact,
    lpDataState,
    updateLpPatch,
    handleImportedDesignSheetFields,
    handleExportDesignSheet,
    applyPlanStructurePatch,
    documentInclusions,
    sectionSummaries,
    blockerDetails,
    readinessComplete,
    readinessCompletedCount,
    readinessTotal,
  } = s

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [attorneyPreset, setAttorneyPreset] = useState<AttorneyDesignPreset | null>(null)
  const attorneyPresetVersionRef = useRef(0)
  const appliedInitialFocusRef = useRef<DesignInitialFocus | null>(null)
  const pageScrollContainerRef = useRef<HTMLElement>(null)
  const pageScrollTopRef = useRef(0)
  const previousPageSectionIdRef = useRef<string | null>(null)
  const { loadPreferences } = useUserPreferences()

  useEffect(() => {
    let active = true
    const loadVersion = attorneyPresetVersionRef.current
    void loadPreferences().then(preferences => {
      if (active && attorneyPresetVersionRef.current === loadVersion) {
        setAttorneyPreset(preferences?.drafting?.attorneyPreset ?? null)
      }
    })
    return () => { active = false }
  }, [loadPreferences])

  const handleAttorneyPresetChange = useCallback((preset: AttorneyDesignPreset) => {
    attorneyPresetVersionRef.current += 1
    setAttorneyPreset(preset)
  }, [])

  const summaries = useMemo<Record<string, DesignSectionSummary>>(() => ({
    ...sectionSummaries,
    'intake-review': intakeSnapshot
      ? { status: 'complete', detail: 'read-only' }
      : { status: 'none', detail: 'no intake data' },
  }), [intakeSnapshot, sectionSummaries])

  const lastName = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/).pop() ?? ''
  const includesTrust = documentInclusions.trust

  const selectedDocKeys = useMemo(
    () => (Object.keys(documentInclusions) as Array<keyof DesignDocumentInclusions>)
      .filter((k): k is DesignDocumentKey => k !== 'spouse_docs' && documentInclusions[k]),
    [documentInclusions],
  )

  const clientDisplayName = [matter.client_name, matter.spouse_name].filter(Boolean).join(' & ')
  const matterLabel = `${matter.matter_name || 'Matter'} · ${clientDisplayName}`

  const sectionDefs = useMemo(
    () => buildDesignSectionDefs({
      matterId,
      sheet,
      matter,
      contacts: contactsState,
      intakeSnapshot,
      isLP,
      lpDataState,
      documentInclusions,
      selectedDocKeysCount: selectedDocKeys.length,
      updateField,
      updateLpPatch,
      handleAddContact,
      handleUpdateContact,
      handleRemoveContact,
    }),
    [
      contactsState,
      documentInclusions,
      handleAddContact,
      handleRemoveContact,
      handleUpdateContact,
      intakeSnapshot,
      isLP,
      lpDataState,
      matter,
      matterId,
      selectedDocKeys.length,
      sheet,
      updateField,
      updateLpPatch,
    ],
  )

  const visibleSections = useMemo(() => visibleDesignSections(sectionDefs), [sectionDefs])
  const groupedSections = useMemo(
    () => groupGuidedSections(visibleSections, summaries),
    [summaries, visibleSections],
  )
  const resolvedSectionId = resolveDesignSectionId(sectionDefs, activeSectionId)
  if (previousPageSectionIdRef.current !== resolvedSectionId) {
    previousPageSectionIdRef.current = resolvedSectionId
    pageScrollTopRef.current = 0
  }

  useLayoutEffect(() => {
    const pageScrollContainer = pageScrollContainerRef.current
    if (pageScrollContainer) pageScrollContainer.scrollTop = pageScrollTopRef.current
  })

  const handlePageScroll = (event: UIEvent<HTMLElement>) => {
    pageScrollTopRef.current = event.currentTarget.scrollTop
  }

  const activeSection = resolvedSectionId
    ? visibleSections.find(section => section.id === resolvedSectionId) ?? null
    : null
  const activeIndex = activeSection ? visibleSections.findIndex(section => section.id === activeSection.id) : -1

  const summarySections = useMemo(
    () => buildSummarySectionItems(summaries, documentInclusions, intakeSnapshot, sheet, matter),
    [documentInclusions, intakeSnapshot, matter, sheet, summaries],
  )

  const trustName = lastName
    ? includesTrust ? `The ${lastName} Family Trust` : `The ${lastName} Family Plan`
    : matter.matter_name || 'Estate plan design'

  const peopleLine = [
    clientDisplayName || sheet.client_name || 'Client',
    sheet.spouse_name ? `spouse: ${sheet.spouse_name}` : '',
  ].filter(Boolean).join(' · ')

  const pendingFiduciaries = useMemo(() => {
    const states = sheet.fiduciary_slot_states ?? {}
    return Object.entries(states)
      .filter(([, v]) => v === 'pending_client')
      .map(([key]) => key)
  }, [sheet.fiduciary_slot_states])

  const sectionHref = useCallback((sectionId: string) => designSectionHref(matterId, sectionId, embedded), [embedded, matterId])
  const overviewHref = designOverviewHref(matterId, embedded)

  const navigateToSection = useCallback((sectionId: string, focus?: { sectionId: string; targetField: string | null }) => {
    startNavigation(() => {
      if (embedded) {
        const params = new URLSearchParams(window.location.search)
        params.set('step', 'design')
        params.set('section', sectionId)
        if (focus) params.set('focus', `${focus.sectionId}:${focus.targetField ?? ''}`)
        else params.delete('focus')
        router.push(`/admin/drafting/${matterId}?${params.toString()}`, { scroll: false })
        return
      }
      const params = new URLSearchParams()
      params.set('section', sectionId)
      if (focus) params.set('focus', `${focus.sectionId}:${focus.targetField ?? ''}`)
      router.push(`/admin/drafting/${matterId}/design?${params.toString()}`, { scroll: false })
    })
  }, [embedded, matterId, router, startNavigation])

  const navigateByHref = useCallback((href: string) => {
    startNavigation(() => {
      router.push(href, { scroll: false })
    })
  }, [router, startNavigation])

  useEffect(() => {
    if (!initialFocus || !activeSection) return
    if (!shouldApplyDesignInitialFocus(initialFocus, activeSection.id, appliedInitialFocusRef.current)) return
    appliedInitialFocusRef.current = initialFocus
    const targetId = initialFocus.targetField ? designFieldTargetId(initialFocus.targetField) : null
    requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : document.getElementById(`design-section-${activeSection.id}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (target instanceof HTMLElement) {
        if (!targetId) target.tabIndex = -1
        target.focus({ preventScroll: true })
        target.classList.add('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
        window.setTimeout(() => {
          target.classList.remove('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
        }, 1600)
      }
    })
  }, [activeSection, initialFocus])

  const introTitle = lastName
    ? `Let's build the ${lastName} family plan`
    : "Let's finalize this estate plan design"

  const previousHref = activeIndex > 0 ? sectionHref(visibleSections[activeIndex - 1].id) : null
  const nextHref = activeIndex >= 0 && activeIndex < visibleSections.length - 1
    ? sectionHref(visibleSections[activeIndex + 1].id)
    : null
  const allBlockers = useMemo(() => blockerDetails.flatMap(group => group.blockers), [blockerDetails])
  const nextRequired = findNextUnresolvedBlocker(allBlockers, resolvedSectionId)

  const introSubtitle = `${readinessCompletedCount} of ${readinessTotal} sections done · ${allBlockers.length} item${allBlockers.length === 1 ? '' : 's'} need${allBlockers.length === 1 ? 's' : ''} a decision. Nothing blocks drafting.`

  const accelerationControls = (variant: 'slim' | 'inline') => (
    <DesignAccelerationBar
      sheet={sheet}
      updateField={updateField}
      documentInclusions={documentInclusions}
      nextRequired={nextRequired}
      onNextRequired={(blocker) => navigateToSection(blocker.sectionId, blocker)}
      showLayoutControls={false}
      attorneyPreset={attorneyPreset}
      onAttorneyPresetChange={handleAttorneyPresetChange}
      variant={variant}
    />
  )

  // Autosave owns persistence; Cmd/Ctrl+S stays wired as a manual fallback.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  return (
    <SharedFieldsProvider>
    <DesignValidationProvider value={validationValue}>
      <div className={cn('guided-interview flex min-h-0 flex-col', embedded ? 'h-full overflow-hidden' : 'h-full')}>
        <ClonePlanDialog
          open={cloneDialogOpen}
          onOpenChange={setCloneDialogOpen}
          matterId={matterId}
          onApply={applyPlanStructurePatch}
        />
        {importDialogOpen && (
          <DesignSheetImportDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            matterId={matterId}
            currentSheet={sheet}
            onAccepted={handleImportedDesignSheetFields}
          />
        )}

        <div style={embedded ? { ...guidedEmbeddedPageStyle, display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'hidden' } : guidedPageStyle}>
          <div style={{ maxWidth: 1180, margin: '0 auto', ...(embedded ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, overflow: 'hidden' } : {}) }}>
            {!embedded && (
              <div style={{ marginBottom: 16 }}>
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" asChild>
                  <Link href={`/admin/matters/${matterId}`}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to matter
                  </Link>
                </Button>
              </div>
            )}

            <BrandBar
              saveStatus={mapSaveStatus(saveStatus)}
              matterLabel={matterLabel}
              savedLabel={saveStatusText}
              dirtyLabel="Unsaved changes"
              actions={(
                <DesignToolbarActions
                  collapsed
                  onClonePlan={() => setCloneDialogOpen(true)}
                  onImport={() => setImportDialogOpen(true)}
                  onSave={handleSave}
                  onExport={handleExportDesignSheet}
                  saveLabel={saveStatus === 'dirty' ? 'Save Changes' : 'Saved'}
                  saving={saveStatus === 'saving'}
                  exporting={exporting}
                  pending={isPending}
                  saveDirty={saveStatus === 'dirty'}
                  showSave={false}
                />
              )}
            />

            <div
              style={{
                display: 'flex',
                gap: 22,
                alignItems: embedded ? 'stretch' : 'flex-start',
                flex: embedded ? 1 : undefined,
                minHeight: embedded ? 0 : undefined,
                overflow: embedded ? 'hidden' : undefined,
              }}
            >
              <main
                ref={pageScrollContainerRef}
                onScroll={handlePageScroll}
                style={{ flex: 3, minWidth: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 18, ...(embedded ? { minHeight: 0, overflowY: 'auto' } : {}) }}
              >
                {activeSection && accelerationControls('slim')}
                {activeSection ? (
                  <DesignSectionPageView
                    section={activeSection}
                    sectionIndex={activeIndex}
                    sectionTotal={visibleSections.length}
                    summary={summaries[activeSection.id]}
                    overviewHref={overviewHref}
                    previousHref={previousHref}
                    nextHref={nextHref}
                    onNavigate={navigateByHref}
                    nextUnresolvedLabel={nextRequired?.label}
                    onNextUnresolved={nextRequired
                      ? () => navigateToSection(nextRequired.sectionId, nextRequired)
                      : undefined}
                  />
                ) : (
                  <DesignSectionOverview
                    title={introTitle}
                    subtitle={introSubtitle}
                    actions={accelerationControls('inline')}
                    groupedSections={groupedSections}
                    summaries={summaries}
                    summarySections={summarySections}
                    sectionHref={sectionHref}
                  />
                )}
                {!activeSection && readinessComplete && (
                  <DesignFinalReview
                    sheet={sheet}
                    selectedDocKeys={selectedDocKeys}
                    blockerDetails={blockerDetails}
                    pendingFiduciaries={pendingFiduciaries}
                    readinessComplete={readinessComplete}
                    onGenerate={onOpenDrafting}
                    attorneyPreset={attorneyPreset}
                  />
                )}
              </main>

              <div
                className={cn('hidden lg:block', embedded && 'min-h-0 overflow-y-auto overscroll-contain')}
                style={{ flex: 1, minWidth: 300 }}
              >
                <DesignSummaryRail
                  trustName={trustName}
                  peopleLine={peopleLine}
                  planTypeLabel={sheet.plan_type ? designPlanTypeLabel(sheet.plan_type) : undefined}
                  documentInclusions={documentInclusions}
                  selectedDocKeys={selectedDocKeys}
                  sections={summarySections}
                  readinessComplete={readinessComplete}
                  readinessCompletedCount={readinessCompletedCount}
                  readinessTotal={readinessTotal}
                  blockerDetails={blockerDetails}
                  onSectionClick={navigateToSection}
                  onGenerate={onOpenDrafting}
                  generateLabel="Generate drafts →"
                  pendingFiduciaries={pendingFiduciaries}
                  activeSectionId={resolvedSectionId ?? undefined}
                  layout={embedded ? 'column' : 'sticky'}
                />
              </div>
            </div>

            <div className="mt-6 lg:hidden">
              <DesignSummaryRail
                trustName={trustName}
                peopleLine={peopleLine}
                planTypeLabel={sheet.plan_type ? designPlanTypeLabel(sheet.plan_type) : undefined}
                documentInclusions={documentInclusions}
                selectedDocKeys={selectedDocKeys}
                sections={summarySections}
                readinessComplete={readinessComplete}
                readinessCompletedCount={readinessCompletedCount}
                readinessTotal={readinessTotal}
                blockerDetails={blockerDetails}
                onSectionClick={navigateToSection}
                onGenerate={onOpenDrafting}
                generateLabel="Generate drafts →"
                pendingFiduciaries={pendingFiduciaries}
                activeSectionId={resolvedSectionId ?? undefined}
                stickyTop={0}
              />
            </div>
          </div>
        </div>
      </div>
    </DesignValidationProvider>
    </SharedFieldsProvider>
  )
}
