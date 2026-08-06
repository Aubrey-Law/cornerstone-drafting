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
  resolveDesignSheetGroupId,
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

/** Final section: signing mechanics + drafting review. Synthetic — not in the section catalog. */
const REVIEW_GROUP = {
  id: DESIGN_SHEET_GROUP_IDS.review,
  title: 'Review & sign',
  subtitle: 'Signing mechanics and final drafting review',
} as const

/** Transient highlight applied to a blocker's target so the eye lands on the right decision. */
function flashDesignTarget(target: HTMLElement) {
  target.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
  window.setTimeout(() => {
    target.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background')
  }, 1600)
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
  // `null` falls back to the first visible group. Seeded from the URL hash so
  // deep links (matter overview "fix this", copied URLs) land on their section.
  const [activeGroupId, setActiveGroupId] = useState<DesignSheetGroupId | null>(() =>
    typeof window === 'undefined' ? null : resolveDesignSheetGroupId(window.location.hash.replace(/^#/, '')),
  )
  const [fiduciaryFlashField, setFiduciaryFlashField] = useState<string | null>(null)
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
    fiduciaryFlashField,
  }), [
    contactsState,
    documentInclusions,
    fiduciaryFlashField,
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

  const navGroups = useMemo(() => [
    ...groups.map(group => {
      const counts = groupReadiness.get(group.id)
      return {
        id: group.id,
        title: group.title,
        blockingCount: counts?.blocking.length ?? 0,
        optionalCount: counts?.optional.length ?? 0,
        blockingLabels: counts?.blocking.map(item => item.label) ?? [],
        optionalLabels: counts?.optional.map(item => item.label) ?? [],
      }
    }),
    {
      id: REVIEW_GROUP.id,
      title: REVIEW_GROUP.title,
      blockingCount: 0,
      optionalCount: 0,
      blockingLabels: [],
      optionalLabels: [],
    },
  ], [groupReadiness, groups])

  // One section at a time: the active group falls back to the first visible
  // group when unset or hidden by "Hide what this plan doesn't use".
  const resolvedActiveGroupId: DesignSheetGroupId = useMemo(() => {
    if (activeGroupId && navGroups.some(group => group.id === activeGroupId)) return activeGroupId
    return navGroups[0]?.id ?? REVIEW_GROUP.id
  }, [activeGroupId, navGroups])
  const activeGroup = useMemo(
    () => groups.find(group => group.id === resolvedActiveGroupId) ?? null,
    [groups, resolvedActiveGroupId],
  )
  const activeIndex = navGroups.findIndex(group => group.id === resolvedActiveGroupId)
  const previousGroup = activeIndex > 0 ? navGroups[activeIndex - 1] : null
  const nextGroup = activeIndex >= 0 && activeIndex < navGroups.length - 1 ? navGroups[activeIndex + 1] : null
  const activeTitle = activeGroup?.title ?? REVIEW_GROUP.title

  const setContainerScrollTop = useCallback((target: HTMLElement, clearance = STICKY_CONTENT_OFFSET) => {
    const container = scrollContainerRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const targetTop = target.getBoundingClientRect().top
    container.scrollTop += targetTop - containerTop - clearance
  }, [])

  /**
   * Switches the visible section. Keeps the same `#<groupId>` hash contract the
   * scroll version used, so external "fix this" links keep working. With a
   * `targetField`, scrolls to and flashes that field once the section mounts;
   * otherwise focus moves to the section heading for keyboard/SR continuity.
   */
  const selectGroup = useCallback((
    groupId: DesignSheetGroupId,
    options: { targetField?: string | null } = {},
  ) => {
    setActiveGroupId(groupId)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${groupId}`)
    const targetField = options.targetField ?? null
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const container = scrollContainerRef.current
        if (container) container.scrollTop = 0
        const target = targetField ? document.getElementById(designFieldTargetId(targetField)) : null
        if (target instanceof HTMLElement) {
          setContainerScrollTop(target)
          target.focus({ preventScroll: true })
          flashDesignTarget(target)
          return
        }
        const heading = document.getElementById('design-active-group-heading')
        if (heading instanceof HTMLElement) {
          heading.tabIndex = -1
          heading.focus({ preventScroll: true })
        }
      })
    })
  }, [setContainerScrollTop])

  const handleBlockerSelect = useCallback((item: { sectionId: string; targetField: string | null }) => {
    const groupId = designSectionAnchorId(item.sectionId)
    if (!groupId) return
    selectGroup(groupId, { targetField: item.targetField })
    // Fiduciary blockers target a grid role column, not a single input — tint
    // the whole column so the missing assignment is obvious.
    if (item.targetField?.endsWith('_slots')) setFiduciaryFlashField(item.targetField)
  }, [selectGroup])

  useEffect(() => {
    if (!fiduciaryFlashField) return
    const timer = window.setTimeout(() => setFiduciaryFlashField(null), 1600)
    return () => window.clearTimeout(timer)
  }, [fiduciaryFlashField])

  useEffect(() => {
    const normalized = normalizeDesignSectionId(requestedSectionId)
    const groupId = resolveDesignSheetGroupId(requestedSectionId)
    if (!groupId || appliedSectionRef.current === normalized) return
    appliedSectionRef.current = normalized
    selectGroup(groupId)
  }, [requestedSectionId, selectGroup])

  useEffect(() => {
    if (!initialFocus) return
    const normalizedSectionId = normalizeDesignSectionId(initialFocus.sectionId)
    if (!shouldApplyDesignInitialFocus(initialFocus, normalizedSectionId, appliedInitialFocusRef.current)) return
    const groupId = designSectionAnchorId(normalizedSectionId)
    if (!groupId) return
    appliedInitialFocusRef.current = initialFocus
    setActiveGroupId(groupId)
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
        flashDesignTarget(target)
      })
    })
  }, [initialFocus, setContainerScrollTop])

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
          className="guided-interview guided-zinc min-h-0 overflow-y-auto bg-background"
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
                activeGroupId={resolvedActiveGroupId}
                hideUnusedDecisions={hideUnusedDecisions}
                hiddenDecisionCount={hiddenDecisionCount}
                onHideUnusedChange={handleHideUnusedChange}
                onSelectGroup={groupId => {
                  selectGroup(groupId)
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
                              onClick={() => handleBlockerSelect(item)}
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
                <div className="mb-3">
                  <p className="text-category text-muted-foreground">
                    Section {activeIndex + 1} of {navGroups.length}
                  </p>
                  <h2
                    id="design-active-group-heading"
                    tabIndex={-1}
                    className="admin-section-title outline-none"
                  >
                    {activeTitle}
                  </h2>
                </div>
                {activeGroup ? (
                  <GroupCard
                    key={activeGroup.id}
                    id={activeGroup.id}
                    title={activeGroup.title}
                    summary={activeGroup.subtitle}
                    headerAction={activeGroup.id === DESIGN_SHEET_GROUP_IDS.facts && intakeSnapshot ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto shrink-0 px-1 text-xs text-primary"
                        onClick={() => setIntakeSnapshotOpen(true)}
                      >
                        View intake snapshot
                      </Button>
                    ) : undefined}
                    blockingCount={groupReadiness.get(activeGroup.id)?.blocking.length ?? 0}
                    optionalCount={groupReadiness.get(activeGroup.id)?.optional.length ?? 0}
                    blockingLabels={groupReadiness.get(activeGroup.id)?.blocking.map(item => item.label) ?? []}
                    optionalLabels={groupReadiness.get(activeGroup.id)?.optional.map(item => item.label) ?? []}
                    scrollMarginTop={STICKY_CONTENT_OFFSET}
                  >
                    {activeGroup.render()}
                  </GroupCard>
                ) : (
                  <>
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
                  </>
                )}
                <nav
                  aria-label="Section pagination"
                  className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4"
                >
                  {previousGroup ? (
                    <Button type="button" variant="outline" onClick={() => selectGroup(previousGroup.id)}>
                      Back: {previousGroup.title}
                    </Button>
                  ) : <span />}
                  {nextGroup ? (
                    <Button type="button" onClick={() => selectGroup(nextGroup.id)}>
                      Next: {nextGroup.title}
                    </Button>
                  ) : null}
                </nav>
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
