'use client'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import '@/app/intake/guided.css'
import {
  BrandBar,
  DesignToolbarActions,
  type GuidedSaveStatus,
} from '@/components/guided'
import { DesignAccelerationBar } from '@/components/design-sheet/DesignAccelerationBar'
import { ClausePreview } from '@/components/design-sheet/ClausePreview'
import { DesignFinalReview } from '@/components/design-sheet/DesignFinalReview'
import {
  ResponsiveDetailRail,
  useIsMobileDetailViewport,
} from '@/components/layout/ResponsiveDetailRail'
import { Button } from '@/components/ui/button'
import { SharedFieldsProvider } from '@/components/sharedFields/provider'
import { cn } from '@/lib/utils'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import {
  DESIGN_SHEET_GROUP_IDS,
  designSectionAnchorId,
  normalizeDesignSectionId,
  type DesignSheetGroupId,
} from '@/lib/designSheet/sectionIds'
import {
  shouldApplyDesignInitialFocus,
  type DesignInitialFocus,
} from '@/lib/designFocusNavigation'
import {
  useDesignSheetState,
  type DesignSheetState,
} from '@/lib/designSheet/useDesignSheetState'
import { useUserPreferences } from '@/lib/userPreferencesClient'
import {
  resolveClausePreviewOpen,
  resolveDesignNavCollapsed,
  resolveHideUnusedDesignDecisions,
} from '@/lib/userPreferences'
import type { AttorneyDesignPreset } from '@/lib/designSheet/fastEntryWorkflow'
import type { DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import {
  buildDesignSectionDefs,
  buildDesignSheetGroups,
  visibleDesignSections,
} from './designSectionCatalog'
import { DesignSectionNav } from './DesignSectionNav'
import { DesignValidationProvider, GroupCard } from './sections/shared'
import { IntakeSnapshotDialog } from './sections/IntakeSection'
import { SigningMechanicsSection } from './sections/SigningMechanicsSection'

const ClonePlanDialog = dynamic(
  () => import('@/components/design-sheet/ClonePlanDialog').then(module => ({ default: module.ClonePlanDialog })),
  { ssr: false },
)

const DesignSheetImportDialog = dynamic(
  () => import('@/components/design-sheet/DesignSheetImportDialog').then(module => ({ default: module.DesignSheetImportDialog })),
  { ssr: false },
)

const APP_HEADER_HEIGHT = 60
const READINESS_STRIP_HEIGHT = 90
const STICKY_CONTENT_OFFSET = APP_HEADER_HEIGHT + READINESS_STRIP_HEIGHT

export interface DesignSheetPageProps {
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
  requestedSectionId?: string | null
  initialFocus?: DesignInitialFocus | null
  designState?: DesignSheetState
}

function saveStatusForHeader(status: DesignSheetState['saveStatus']): GuidedSaveStatus {
  return status
}

function DesignSheetPageWithState(props: DesignSheetPageProps) {
  const state = useDesignSheetState({
    matterId: props.matterId,
    matter: props.matter,
    contacts: props.contacts,
    sheet: props.sheet,
    lpData: props.lpData,
  })
  return <DesignSheetPageContent {...props} designState={state} />
}

export default function DesignSheetPage(props: DesignSheetPageProps) {
  if (props.designState) return <DesignSheetPageContent {...props} designState={props.designState} />
  return <DesignSheetPageWithState {...props} />
}

function DesignSheetPageContent({
  matterId,
  matter,
  intakeSnapshot,
  embedded = false,
  onOpenDrafting,
  requestedSectionId = null,
  initialFocus = null,
  designState: state,
}: DesignSheetPageProps & { designState: DesignSheetState }) {
  const router = useRouter()
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
    blockingCount,
    optionalCount,
    blockingDetails,
  } = state

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const appliedInitialFocusRef = useRef<DesignInitialFocus | null>(null)
  const appliedSectionRef = useRef<string | null>(null)
  const attorneyPresetVersionRef = useRef(0)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [intakeSnapshotOpen, setIntakeSnapshotOpen] = useState(false)
  const [attorneyPreset, setAttorneyPreset] = useState<AttorneyDesignPreset | null>(null)
  const [hideUnusedDecisions, setHideUnusedDecisions] = useState(true)
  const [clausePreviewOpen, setClausePreviewOpen] = useState(true)
  // Desktop keeps a persisted docked/hidden preference; the phone sheet is
  // transient and always starts closed so the form is what you land on.
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<DesignSheetGroupId>>(new Set())
  const { loadPreferences, savePreferences } = useUserPreferences()
  const isMobile = useIsMobileDetailViewport()

  useEffect(() => {
    let active = true
    const loadVersion = attorneyPresetVersionRef.current
    void loadPreferences().then(preferences => {
      if (!active) return
      setHideUnusedDecisions(resolveHideUnusedDesignDecisions(preferences))
      setClausePreviewOpen(resolveClausePreviewOpen(preferences))
      setNavCollapsed(resolveDesignNavCollapsed(preferences))
      if (attorneyPresetVersionRef.current === loadVersion) {
        setAttorneyPreset(preferences?.drafting?.attorneyPreset ?? null)
      }
    })
    return () => { active = false }
  }, [loadPreferences])

  const handleAttorneyPresetChange = useCallback((preset: AttorneyDesignPreset) => {
    attorneyPresetVersionRef.current += 1
    setAttorneyPreset(preset)
  }, [])

  const selectedDocKeysCount = useMemo(
    () => Object.entries(documentInclusions)
      .filter(([key, included]) => key !== 'spouse_docs' && included)
      .length,
    [documentInclusions],
  )
  const selectedDocKeys = useMemo(
    () => Object.entries(documentInclusions)
      .filter(([key, included]) => key !== 'spouse_docs' && included)
      .map(([key]) => key as DesignDocumentKey),
    [documentInclusions],
  )
  const pendingFiduciaries = useMemo(
    () => [...blockingDetails, ...state.optionalDetails]
      .flatMap(detail => detail.blockers)
      .filter(blocker => designSectionAnchorId(blocker.sectionId) === DESIGN_SHEET_GROUP_IDS.fiduciaries)
      .map(blocker => blocker.label),
    [blockingDetails, state.optionalDetails],
  )

  const sectionDefs = useMemo(() => buildDesignSectionDefs({
    matterId,
    sheet,
    matter,
    contacts: contactsState,
    intakeSnapshot,
    isLP,
    lpDataState,
    documentInclusions,
    selectedDocKeysCount,
    updateField,
    updateLpPatch,
    handleAddContact,
    handleUpdateContact,
    handleRemoveContact,
    showInapplicable: !hideUnusedDecisions,
  }), [
    contactsState,
    documentInclusions,
    handleAddContact,
    handleRemoveContact,
    handleUpdateContact,
    hideUnusedDecisions,
    intakeSnapshot,
    isLP,
    lpDataState,
    matter,
    matterId,
    selectedDocKeysCount,
    sheet,
    updateField,
    updateLpPatch,
  ])

  const hiddenDecisionCount = useMemo(
    () => sectionDefs.filter(section => section.appliesWhen && !section.appliesWhen(sheet)).length,
    [sectionDefs, sheet],
  )
  const displayedSectionDefs = useMemo(
    () => sectionDefs
      .map(section => ({
        ...section,
        applicable: section.appliesWhen ? section.appliesWhen(sheet) : true,
      }))
      .filter(section => !hideUnusedDecisions || section.applicable),
    [hideUnusedDecisions, sectionDefs, sheet],
  )
  const groups = useMemo(
    () => buildDesignSheetGroups(visibleDesignSections(displayedSectionDefs)),
    [displayedSectionDefs],
  )

  const handleHideUnusedChange = useCallback((checked: boolean) => {
    setHideUnusedDecisions(checked)
    void savePreferences({ drafting: { hideUnusedDesignDecisions: checked } })
  }, [savePreferences])

  const handleClausePreviewToggle = useCallback(() => {
    setClausePreviewOpen(current => {
      const next = !current
      void savePreferences({ drafting: { clausePreviewOpen: next } })
      return next
    })
  }, [savePreferences])

  const navOpen = isMobile ? mobileNavOpen : !navCollapsed

  const handleNavOpenChange = useCallback((open: boolean) => {
    if (isMobile) {
      setMobileNavOpen(open)
      return
    }
    setNavCollapsed(!open)
    void savePreferences({ drafting: { designNavCollapsed: !open } })
  }, [isMobile, savePreferences])

  const groupReadiness = useMemo(() => new Map(groups.map(group => {
    const sectionIds = new Set(group.sections.map(section => section.id))
    const blocking = blockingDetails
      .filter(detail => sectionIds.has(detail.id))
      .flatMap(detail => detail.blockers)
    const optional = state.optionalDetails
      .filter(detail => sectionIds.has(detail.id))
      .flatMap(detail => detail.blockers)
    return [group.id, { blocking, optional }] as const
  })), [blockingDetails, groups, state.optionalDetails])

  const navGroups = useMemo(() => groups.map(group => {
    const counts = groupReadiness.get(group.id)
    return {
      id: group.id,
      title: group.title,
      blockingCount: counts?.blocking.length ?? 0,
      optionalCount: counts?.optional.length ?? 0,
    }
  }), [groupReadiness, groups])

  const setGroupOpen = useCallback((groupId: DesignSheetGroupId, open: boolean) => {
    setCollapsedGroups(current => {
      const next = new Set(current)
      if (open) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const setContainerScrollTop = useCallback((target: HTMLElement, clearance = STICKY_CONTENT_OFFSET) => {
    const container = scrollContainerRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const targetTop = target.getBoundingClientRect().top
    container.scrollTop += targetTop - containerTop - clearance
  }, [])

  const scrollToGroup = useCallback((
    groupId: DesignSheetGroupId,
    options: { updateHash?: boolean; smooth?: boolean } = {},
  ) => {
    setGroupOpen(groupId, true)
    window.requestAnimationFrame(() => {
      const target = document.getElementById(groupId)
      if (!target) return
      setContainerScrollTop(target)
      if (options.updateHash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${groupId}`)
      }
    })
  }, [setContainerScrollTop, setGroupOpen])

  useEffect(() => {
    const normalized = normalizeDesignSectionId(requestedSectionId)
    const groupId = designSectionAnchorId(normalized)
    if (!groupId || appliedSectionRef.current === normalized) return
    appliedSectionRef.current = normalized
    scrollToGroup(groupId)
  }, [requestedSectionId, scrollToGroup])

  useEffect(() => {
    if (!initialFocus) return
    const normalizedSectionId = normalizeDesignSectionId(initialFocus.sectionId)
    if (!shouldApplyDesignInitialFocus(initialFocus, normalizedSectionId, appliedInitialFocusRef.current)) return
    const groupId = designSectionAnchorId(normalizedSectionId)
    if (!groupId) return
    appliedInitialFocusRef.current = initialFocus
    setGroupOpen(groupId, true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const targetId = initialFocus.targetField ? designFieldTargetId(initialFocus.targetField) : null
        const target = targetId
          ? document.getElementById(targetId)
          : document.getElementById(`design-section-${normalizedSectionId}`)
        if (!(target instanceof HTMLElement)) return
        setContainerScrollTop(target)
        if (!targetId) target.tabIndex = -1
        target.focus({ preventScroll: true })
        target.classList.add('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
        window.setTimeout(() => {
          target.classList.remove('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
        }, 1600)
      })
    })
  }, [initialFocus, setContainerScrollTop, setGroupOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const openDrafting = useCallback(() => {
    if (onOpenDrafting) {
      onOpenDrafting()
      return
    }
    router.push(`/admin/drafting/${matterId}?step=generate`, { scroll: false })
  }, [matterId, onOpenDrafting, router])

  const matterLabel = `${matter.matter_name || 'Matter'} · ${[matter.client_name, matter.spouse_name].filter(Boolean).join(' & ')}`
  const pageHeight = embedded ? '100%' : 'calc(100vh - 64px)'
  const indexStyle: CSSProperties = {
    position: 'sticky',
    top: APP_HEADER_HEIGHT,
    height: `calc(100vh - ${APP_HEADER_HEIGHT}px)`,
    overflowY: 'auto',
    alignSelf: 'flex-start',
  }

  /**
   * One column on phones — the index moves into its own sheet there, and the
   * clause preview is dropped rather than squeezed. Wider viewports add the
   * docked index and, when open, the preview.
   */
  const gridTemplateColumns = isMobile
    ? 'minmax(0, 1fr)'
    : [
        navOpen ? '244px' : null,
        'minmax(0, 1fr)',
        clausePreviewOpen ? '400px' : null,
      ].filter(Boolean).join(' ')

  return (
    <SharedFieldsProvider>
      <DesignValidationProvider value={validationValue}>
        <div
          ref={scrollContainerRef}
          className="guided-interview min-h-0 overflow-y-auto bg-background"
          style={{ height: pageHeight }}
        >
          <ClonePlanDialog
            open={cloneDialogOpen}
            onOpenChange={setCloneDialogOpen}
            matterId={matterId}
            onApply={applyPlanStructurePatch}
          />
          {importDialogOpen ? (
            <DesignSheetImportDialog
              open={importDialogOpen}
              onOpenChange={setImportDialogOpen}
              matterId={matterId}
              currentSheet={sheet}
              onAccepted={handleImportedDesignSheetFields}
            />
          ) : null}
          {intakeSnapshot ? (
            <IntakeSnapshotDialog
              open={intakeSnapshotOpen}
              onOpenChange={setIntakeSnapshotOpen}
              intake={intakeSnapshot}
              matterId={matterId}
            />
          ) : null}

          <header
            className="sticky z-40 border-b border-border bg-card px-4 [&>div]:!mb-0 [&>div]:!h-full [&>div]:!flex-nowrap"
            style={{ top: 0, height: APP_HEADER_HEIGHT }}
          >
            <BrandBar
              saveStatus={saveStatusForHeader(saveStatus)}
              matterLabel={matterLabel}
              savedLabel={saveStatusText}
              dirtyLabel="Unsaved changes"
              actions={(
                <>
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
                  <DesignAccelerationBar
                    sheet={sheet}
                    updateField={updateField}
                    documentInclusions={documentInclusions}
                    attorneyPreset={attorneyPreset}
                    onAttorneyPresetChange={handleAttorneyPresetChange}
                  />
                </>
              )}
            />
          </header>

          <div
            className="mx-auto grid w-full max-w-[1680px] gap-5 px-4"
            style={{ gridTemplateColumns }}
          >
            <ResponsiveDetailRail
              open={navOpen}
              onOpenChange={handleNavOpenChange}
              label="Design sheet sections"
              desktopClassName="border-r border-border pr-3"
              desktopStyle={indexStyle}
              mobileClassName="overflow-y-auto px-3"
            >
              <DesignSectionNav
                groups={navGroups}
                hideUnusedDecisions={hideUnusedDecisions}
                hiddenDecisionCount={hiddenDecisionCount}
                onHideUnusedChange={handleHideUnusedChange}
                onSelectGroup={groupId => {
                  scrollToGroup(groupId, { updateHash: true, smooth: true })
                  setMobileNavOpen(false)
                }}
              />
            </ResponsiveDetailRail>

            <main className="min-w-0 pb-10">
              <section
                className="sticky z-30 -mx-1 border-b border-border bg-background/95 px-1 py-3 backdrop-blur"
                style={{ top: APP_HEADER_HEIGHT, minHeight: READINESS_STRIP_HEIGHT }}
                aria-label="Draft readiness"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className={cn('text-sm font-semibold', blockingCount > 0 ? 'text-warning' : 'text-success')}>
                      {blockingCount > 0
                        ? `${blockingCount} decision${blockingCount === 1 ? '' : 's'} block drafting`
                        : 'Ready to draft'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {optionalCount} optional refinement{optionalCount === 1 ? '' : 's'} remaining.
                    </p>
                    {blockingCount > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {blockingDetails.flatMap(detail => detail.blockers).map(item => {
                          const groupId = designSectionAnchorId(item.sectionId)
                          if (!groupId) return null
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => scrollToGroup(groupId, { updateHash: true, smooth: true })}
                              className="rounded-full border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning hover:bg-warning/15"
                            >
                              {item.label}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={navOpen}
                      onClick={() => handleNavOpenChange(!navOpen)}
                    >
                      {navOpen ? (
                        <PanelLeftClose className="h-4 w-4" aria-hidden />
                      ) : (
                        <PanelLeft className="h-4 w-4" aria-hidden />
                      )}
                      <span className="hidden sm:inline">{navOpen ? 'Hide sections' : 'Sections'}</span>
                      <span className="sr-only sm:hidden">
                        {navOpen ? 'Hide sections' : 'Show sections'}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-pressed={clausePreviewOpen}
                      onClick={handleClausePreviewToggle}
                      // The preview column is not rendered on phones, so the
                      // control that governs it is hidden there too.
                      className="hidden md:inline-flex"
                    >
                      {clausePreviewOpen ? 'Hide clauses' : 'Preview clauses'}
                    </Button>
                    <Button size="sm" onClick={openDrafting}>Generate drafts</Button>
                  </div>
                </div>
              </section>

              <div className="pt-4">
                {groups.map(group => {
                  const collapsed = collapsedGroups.has(group.id)
                  const counts = groupReadiness.get(group.id)
                  const groupBlockingCount = counts?.blocking.length ?? 0
                  const groupOptionalCount = counts?.optional.length ?? 0
                  return (
                    <GroupCard
                      key={group.id}
                      id={group.id}
                      title={group.title}
                      summary={group.subtitle}
                      headerAction={group.id === DESIGN_SHEET_GROUP_IDS.facts && intakeSnapshot ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto shrink-0 px-1 text-xs text-accent"
                          onClick={() => setIntakeSnapshotOpen(true)}
                        >
                          View intake snapshot
                        </Button>
                      ) : undefined}
                      blockingCount={groupBlockingCount}
                      optionalCount={groupOptionalCount}
                      collapsed={collapsed}
                      onCollapsedChange={nextCollapsed => setGroupOpen(group.id, !nextCollapsed)}
                      scrollMarginTop={STICKY_CONTENT_OFFSET}
                    >
                      {group.render()}
                    </GroupCard>
                  )
                })}
                <SigningMechanicsSection sheet={sheet} onChange={updateField} />
                <DesignFinalReview
                  sheet={sheet}
                  selectedDocKeys={selectedDocKeys}
                  blockingDetails={blockingDetails}
                  optionalDetails={state.optionalDetails}
                  pendingFiduciaries={pendingFiduciaries}
                  readinessComplete={state.readinessComplete}
                  onGenerate={openDrafting}
                  attorneyPreset={attorneyPreset}
                />
              </div>
            </main>

            {clausePreviewOpen && !isMobile ? (
              <aside
                aria-label="Clause preview"
                className="border-l border-border"
                style={{
                  position: 'sticky',
                  top: APP_HEADER_HEIGHT,
                  height: `calc(100vh - ${APP_HEADER_HEIGHT}px)`,
                  alignSelf: 'flex-start',
                }}
              >
                <ClausePreview matterId={matterId} sheet={sheet} />
              </aside>
            ) : null}
          </div>
        </div>
      </DesignValidationProvider>
    </SharedFieldsProvider>
  )
}
