'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Check, ChevronDown, ChevronRight, ClipboardCheck, DollarSign, FileText, Heart, HeartPulse, Landmark, Lightbulb, ScrollText, Shield, Target, User, Users, WandSparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import '@/app/intake/guided.css'
import {
  BrandBar,
  DesignSummaryRail,
  DesignToolbarActions,
  GuidedIntroCard,
  guidedEmbeddedPageStyle,
  type SummarySectionItem,
} from '@/components/guided'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import type { DesignDocumentInclusions, DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import { useDesignSheetState, type DesignSheetState, type LpData } from '@/lib/designSheet/useDesignSheetState'
import { DesignValidationProvider, AccordionBadge } from './sections/shared'
import { SharedFieldsProvider } from '@/components/sharedFields/provider'
import { buildDesignSectionDefs } from './designSectionCatalog'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import type { PipelineMatter, DesignSheet, MatterContact } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { useUserPreferences } from '@/lib/userPreferencesClient'
import type { AttorneyDesignPreset } from '@/lib/designSheet/fastEntryWorkflow'
import {
  applyAttorneyPreset,
  buildAttorneyPreset,
  buildCopyClientToSpousePatch,
  buildTrusteesToPrimaryRolesPatch,
  orderFastEntrySections,
  previewAttorneyPreset,
} from '@/lib/designSheet/fastEntryWorkflow'

const ClonePlanDialog = dynamic(
  () => import('@/components/design-sheet/ClonePlanDialog').then(m => ({ default: m.ClonePlanDialog })),
  { ssr: false },
)

const DesignSheetImportDialog = dynamic(
  () => import('@/components/design-sheet/DesignSheetImportDialog').then(m => ({ default: m.DesignSheetImportDialog })),
  { ssr: false }
)

interface ExpressDesignSheetProps {
  matterId: string
  matter: PipelineMatter
  contacts: MatterContact[]
  sheet: DesignSheet | null
  lpData: LpData | null
  intakeSnapshot: IntakeSnapshot | null
  /** Advance the parent workspace to the Generate step (drafting). */
  onOpenDrafting?: () => void
  /** Optional deep link from generation preflight back to a specific field. */
  initialFocus?: { sectionId: string; targetField: string | null } | null
  /**
   * Parent-owned design sheet state (drafting workspace). When set, this view does not
   * create its own autosave hook — so Guided/Express switches keep edits.
   */
  designState?: DesignSheetState
}

interface SectionDef {
  id: string
  label: string
  icon: React.ElementType
  render: () => React.ReactNode
  badge?: React.ReactNode
}

const SECTION_ICONS: Record<string, React.ElementType> = {
  [DESIGN_SECTION_IDS.intakeReview]: FileText,
  [DESIGN_SECTION_IDS.clientInformation]: User,
  [DESIGN_SECTION_IDS.familyInformation]: Heart,
  [DESIGN_SECTION_IDS.contactsFiduciaries]: Users,
  [DESIGN_SECTION_IDS.fiduciaries]: Shield,
  [DESIGN_SECTION_IDS.estatePlanDesign]: Lightbulb,
  [DESIGN_SECTION_IDS.trustDetails]: Landmark,
  [DESIGN_SECTION_IDS.willDetails]: ScrollText,
  [DESIGN_SECTION_IDS.financialPoa]: Shield,
  [DESIGN_SECTION_IDS.healthcareDirectives]: HeartPulse,
  [DESIGN_SECTION_IDS.assetSchedules]: DollarSign,
  [DESIGN_SECTION_IDS.transfersAssignments]: FileText,
  [DESIGN_SECTION_IDS.attorneyNotes]: Target,
}

/**
 * Streamlined attorney design sheet. Optimised for fast top-to-bottom entry:
 * every section is always expanded in one scrollable column, the right summary
 * rail tracks position and jumps between sections, and there is no client-approval
 * surface. Shares all save/validation behaviour with the guided DesignSheetShell
 * via useDesignSheetState.
 */
export default function ExpressDesignSheet(props: ExpressDesignSheetProps) {
  if (props.designState) {
    return <ExpressDesignSheetImpl {...props} s={props.designState} />
  }
  return <ExpressDesignSheetWithHook {...props} />
}

function ExpressDesignSheetWithHook(props: ExpressDesignSheetProps) {
  const s = useDesignSheetState({
    matterId: props.matterId,
    matter: props.matter,
    contacts: props.contacts,
    sheet: props.sheet,
    lpData: props.lpData,
    applyDefaults: true,
  })
  return <ExpressDesignSheetImpl {...props} s={s} />
}

function ExpressDesignSheetImpl({
  matterId,
  matter,
  intakeSnapshot,
  onOpenDrafting,
  initialFocus = null,
  s,
}: ExpressDesignSheetProps & { s: DesignSheetState }) {
  const {
    isLP, sheet, updateField, validationValue, saveStatus, saveStatusText,
    contactsState, handleAddContact, handleUpdateContact, handleRemoveContact,
    lpDataState, updateLpPatch, handleExportDesignSheet, handleImportedDesignSheetFields, applyPlanStructurePatch,
    handleSave, isPending, exporting, documentInclusions, sectionSummaries,
    blockerDetails, readinessComplete, readinessCompletedCount, readinessTotal,
  } = s

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string>(DESIGN_SECTION_IDS.estatePlanDesign)
  const [showCompleted, setShowCompleted] = useState(false)
  const [expandAll, setExpandAll] = useState(false)
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set())
  const [attorneyPreset, setAttorneyPreset] = useState<AttorneyDesignPreset | null>(null)
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [overwritePresetConflicts, setOverwritePresetConflicts] = useState(false)
  const { loadPreferences, savePreferences } = useUserPreferences()
  const sectionEls = useRef<Record<string, HTMLElement | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const clientDisplayName = [matter.client_name, matter.spouse_name].filter(Boolean).join(' & ') || 'Unnamed client'

  const selectedDocKeysCount = (Object.keys(documentInclusions) as Array<keyof DesignDocumentInclusions>)
    .filter((k): k is DesignDocumentKey => k !== 'spouse_docs' && documentInclusions[k]).length

  const sections = useMemo<SectionDef[]>(() => {
    const defs = buildDesignSectionDefs({
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
    })

    return defs.map(def => ({
      id: def.id,
      label: def.title,
      icon: SECTION_ICONS[def.id] ?? FileText,
      badge: def.id === DESIGN_SECTION_IDS.intakeReview
        ? <Badge className="border-0 bg-muted text-[10px] font-medium text-muted-foreground">Read-only</Badge>
        : def.id === DESIGN_SECTION_IDS.estatePlanDesign
          ? <AccordionBadge variant={isLP ? 'lp' : 'core'}>{isLP ? 'EP-LP' : 'EP'}</AccordionBadge>
          : undefined,
      render: def.render,
    }))
  }, [contactsState, documentInclusions, handleAddContact, handleRemoveContact, handleUpdateContact,
      intakeSnapshot, isLP, lpDataState, matter, matterId, selectedDocKeysCount, sheet, updateField, updateLpPatch])

  const orderedSections = useMemo(
    () => orderFastEntrySections(sections, sectionSummaries),
    [sectionSummaries, sections],
  )

  useEffect(() => {
    void loadPreferences().then(preferences => {
      setAttorneyPreset(preferences?.drafting?.attorneyPreset ?? null)
    })
  }, [loadPreferences])

  const applyPatch = useCallback((patch: Partial<DesignSheet>) => {
    for (const [field, value] of Object.entries(patch)) {
      updateField(field as keyof DesignSheet, value as DesignSheet[keyof DesignSheet])
    }
  }, [updateField])

  const presetPreview = useMemo(
    () => attorneyPreset ? previewAttorneyPreset(sheet, attorneyPreset) : [],
    [attorneyPreset, sheet],
  )

  const handleSavePreset = useCallback(async () => {
    const preset = buildAttorneyPreset(sheet)
    if (Object.keys(preset.fields).length === 0) {
      toast.error('Complete at least one standard structural choice first.')
      return
    }
    const saved = await savePreferences({ drafting: { attorneyPreset: preset } })
    if (!saved) {
      toast.error('Unable to save your standard choices.')
      return
    }
    setAttorneyPreset(preset)
    toast.success('Standard choices saved for future matters.')
  }, [savePreferences, sheet])

  const handleApplyPreset = useCallback(() => {
    if (!attorneyPreset) return
    const patch = applyAttorneyPreset(sheet, attorneyPreset, { overwrite: overwritePresetConflicts })
    applyPatch(patch)
    setPresetDialogOpen(false)
    setOverwritePresetConflicts(false)
    toast.success(`Applied ${Object.keys(patch).length} standard choice${Object.keys(patch).length === 1 ? '' : 's'}.`)
  }, [applyPatch, attorneyPreset, overwritePresetConflicts, sheet])

  // ── Scroll-spy: highlight the section nearest the top of the scroll area ─────
  // Keyed on the section id set (not the section objects, which change on every
  // keystroke) so the observer only re-subscribes when sections appear/disappear.
  const sectionIdsKey = orderedSections.map(s => s.id).join(',')
  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]?.target.id) setActiveSection(visible[0].target.id)
      },
      // Bias the active line near the top of the viewport, below the sticky header.
      { root, rootMargin: '-96px 0px -55% 0px', threshold: 0 },
    )
    Object.values(sectionEls.current).forEach(el => el && observer.observe(el))
    return () => observer.disconnect()
  }, [sectionIdsKey])

  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id)
    // No accordion to expand — section is already open, so a single scroll lands
    // its header just below the sticky bar (scroll-margin-top handles the offset).
    sectionEls.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // Scroll to + ring-highlight a specific blocker field.
  const focusField = useCallback((sectionId: string, targetId: string | null) => {
    const target = (targetId ? document.getElementById(targetId) : null) ?? sectionEls.current[sectionId]
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (target instanceof HTMLElement && targetId) {
      target.focus({ preventScroll: true })
      target.classList.add('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
      window.setTimeout(() => {
        target.classList.remove('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
      }, 1600)
    }
  }, [])

  const initialFocusHandled = useRef(false)
  useEffect(() => {
    if (!initialFocus || initialFocusHandled.current) return
    initialFocusHandled.current = true
    const targetId = initialFocus.targetField ? designFieldTargetId(initialFocus.targetField) : null
    window.requestAnimationFrame(() => focusField(initialFocus.sectionId, targetId))
  }, [focusField, initialFocus])

  const setSectionEl = useCallback((id: string) => (el: HTMLElement | null) => {
    sectionEls.current[id] = el
  }, [])

  const pct = readinessTotal > 0 ? Math.round((readinessCompletedCount / readinessTotal) * 100) : 0
  const lastName = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/).pop() ?? ''
  const includesTrust = documentInclusions.trust
  const trustName = lastName
    ? includesTrust ? `The ${lastName} Family Trust` : `The ${lastName} Family Plan`
    : matter.matter_name || 'Estate plan design'
  const peopleLine = clientDisplayName || sheet.client_name || 'Client'
  const selectedDocKeys = (Object.keys(documentInclusions) as Array<keyof DesignDocumentInclusions>)
    .filter((k): k is DesignDocumentKey => k !== 'spouse_docs' && documentInclusions[k])
  const summarySections = useMemo<SummarySectionItem[]>(
    () => orderedSections.map((s) => ({
      id: s.id,
      label: s.label,
      status: sectionSummaries[s.id]?.status ?? 'none',
      missingCount: sectionSummaries[s.id]?.blockers?.length ?? 0,
    })),
    [orderedSections, sectionSummaries],
  )
  const nextRequired = blockerDetails.flatMap(group => group.blockers)[0] ?? null
  const pendingFiduciaries = Object.entries(sheet.fiduciary_slot_states ?? {})
    .filter(([, value]) => value === 'pending_client')
    .map(([key]) => key)
  const intakeOverrides = Object.keys(sheet.overrides ?? {})
  const appliedPresetFields = attorneyPreset
    ? Object.entries(attorneyPreset.fields)
        .filter(([field, value]) => JSON.stringify(sheet[field as keyof DesignSheet]) === JSON.stringify(value))
        .map(([field]) => field)
    : []

  const toggleCompletedSection = useCallback((id: string) => {
    setExpandedCompleted(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  return (
    <SharedFieldsProvider>
    <DesignValidationProvider value={validationValue}>
      <div className="guided-interview flex h-full min-h-0 flex-col overflow-hidden">
        <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Apply my standard choices</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Only allowlisted structural choices are included. Client elections and intake identity fields are never preset.
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {presetPreview.length === 0 ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">No changes are needed.</p>
              ) : presetPreview.map(item => (
                <div key={item.field} className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium capitalize">{item.field.replace(/_/g, ' ')}</p>
                    {item.conflict && <p className="text-xs text-warning">Existing value will be kept unless overwrite is selected.</p>}
                  </div>
                  <span className="text-right text-xs text-muted-foreground">{String(item.presetValue)}</span>
                </div>
              ))}
            </div>
            {presetPreview.some(item => item.conflict) && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={overwritePresetConflicts} onCheckedChange={value => setOverwritePresetConflicts(value === true)} />
                Replace existing structural choices shown above
              </label>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPresetDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleApplyPreset} disabled={presetPreview.length === 0}>Apply choices</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

        <div style={guidedEmbeddedPageStyle} className="flex min-h-0 flex-1 flex-col">
          <BrandBar
            saveStatus={saveStatus}
            matterLabel={`${clientDisplayName} · Fast entry`}
            savedLabel={saveStatusText}
            actions={(
              <DesignToolbarActions
                onClonePlan={() => setCloneDialogOpen(true)}
                onImport={() => setImportDialogOpen(true)}
                onSave={handleSave}
                onExport={handleExportDesignSheet}
                saveLabel={saveStatus === 'dirty' ? 'Save' : 'Saved'}
                saving={saveStatus === 'saving'}
                exporting={exporting}
                pending={isPending}
                saveDirty={saveStatus === 'dirty'}
                showSave={saveStatus !== 'saved'}
              />
            )}
          />

          <div className="mb-4 px-1">
            <GuidedIntroCard
              pct={pct}
              title={lastName ? `Fast entry — ${lastName} family plan` : 'Fast entry design sheet'}
              subtitle="Unresolved work appears first. Completed sections stay collapsed unless you open them."
            />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            {nextRequired ? (
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => focusField(nextRequired.sectionId, nextRequired.targetId)}>
                <ChevronRight className="h-3.5 w-3.5" />
                Next required: {nextRequired.label}
              </Button>
            ) : (
              <Badge className="border-0 bg-success/10 text-success"><Check className="mr-1 h-3 w-3" />Ready to generate</Badge>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setExpandAll(value => !value)}>
              {expandAll ? 'Collapse completed' : 'Expand all'}
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={showCompleted} onCheckedChange={value => setShowCompleted(value === true)} />
              Show completed
            </label>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            {attorneyPreset && (
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setPresetDialogOpen(true)}>
                <WandSparkles className="h-3.5 w-3.5" />Apply my standards
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => void handleSavePreset()}>
              Save current as my standards
            </Button>
            {documentInclusions.spouse_docs && (
              <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPatch(buildCopyClientToSpousePatch(sheet))}>
                Client selections → spouse
              </Button>
            )}
            {documentInclusions.trust && (
              <Button variant="outline" size="sm" className="text-xs" onClick={() => applyPatch(buildTrusteesToPrimaryRolesPatch(sheet, documentInclusions))}>
                Trustees → primary roles
              </Button>
            )}
          </div>

          {/* Mobile section pills */}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {summarySections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium',
                  activeSection === item.id
                    ? 'border-[var(--gi-teal)] bg-[rgba(26,107,114,.08)] text-[var(--gi-teal)]'
                    : 'border-[var(--gi-border)] text-[var(--gi-muted)]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Main column + summary rail (no duplicate left nav) */}
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          <div ref={scrollContainerRef} className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[900px] px-1 py-1 md:px-2">
              {orderedSections.map(item => {
                const summary = sectionSummaries[item.id]
                const complete = summary?.status === 'complete'
                const collapsed = complete && !expandAll && !expandedCompleted.has(item.id)
                const hidden = complete && !showCompleted && collapsed
                return (
                <section
                  key={item.id}
                  id={item.id}
                  ref={setSectionEl(item.id)}
                  className={cn('mb-4 scroll-mt-24', hidden && 'hidden')}
                  style={{
                    borderRadius: 14,
                    border: '1px solid var(--gi-border)',
                    background: 'var(--gi-surface)',
                    boxShadow: '0 1px 2px rgba(15,23,42,.04)',
                  }}
                >
                  <button type="button" onClick={() => complete && toggleCompletedSection(item.id)} className="flex w-full items-center gap-3 border-b px-[1.125rem] py-[0.8rem] text-left" style={{ borderColor: 'var(--gi-divider)' }}>
                    <span className="flex h-[1.75rem] w-[1.75rem] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(26,107,114,.1)' }}>
                      <item.icon className="h-4 w-4" style={{ color: 'var(--gi-teal)' }} />
                    </span>
                    <span className="flex-1 text-[0.875rem] font-medium" style={{ color: 'var(--gi-ink)' }}>
                      {item.label}
                    </span>
                    {(summary?.blockers?.length ?? 0) > 0 && <Badge variant="outline" className="text-[10px] text-warning">{summary?.blockers?.length} needed</Badge>}
                    {complete && <Badge className="border-0 bg-success/10 text-[10px] text-success">Complete</Badge>}
                    {item.badge}
                    {complete && (collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />)}
                  </button>
                  <div className={cn('px-[1.125rem] py-4', collapsed && 'hidden')} aria-hidden={collapsed}>
                    {item.render()}
                  </div>
                </section>
                )
              })}
              <section className="mb-4 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4 text-accent" />Final review</p>
                    <p className="mt-1 text-xs text-muted-foreground">Only exceptions, unresolved work, and package choices are shown.</p>
                  </div>
                  <Badge className={cn('border-0', readinessComplete ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {readinessComplete ? 'Ready' : `${blockerDetails.flatMap(group => group.blockers).length} unresolved`}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
                  <div><p className="font-semibold text-foreground">Selected documents</p><p className="mt-1 text-muted-foreground">{selectedDocKeys.map(key => key.replace(/_/g, ' ')).join(' · ') || 'None'}</p></div>
                  <div><p className="font-semibold text-foreground">Intake overrides</p><p className="mt-1 text-muted-foreground">{intakeOverrides.map(field => field.replace(/_/g, ' ')).join(' · ') || 'None'}</p></div>
                  <div><p className="font-semibold text-foreground">Applied standards</p><p className="mt-1 text-muted-foreground">{appliedPresetFields.map(field => field.replace(/_/g, ' ')).join(' · ') || 'None'}</p></div>
                  <div><p className="font-semibold text-foreground">Pending client</p><p className="mt-1 text-muted-foreground">{pendingFiduciaries.map(field => field.replace(/_/g, ' ')).join(' · ') || 'None'}</p></div>
                </div>
                {!readinessComplete && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {blockerDetails.flatMap(group => group.blockers).map(blocker => (
                      <button key={blocker.id} type="button" onClick={() => focusField(blocker.sectionId, blocker.targetId)} className="rounded-full border border-warning/40 bg-warning/5 px-2.5 py-1 text-[11px] hover:bg-warning/10">
                        {blocker.label}
                      </button>
                    ))}
                  </div>
                )}
                {onOpenDrafting && <Button className="mt-4 w-full" disabled={!readinessComplete} onClick={onOpenDrafting}>Generate drafts →</Button>}
              </section>
            </div>
          </div>

          <aside className="hidden min-h-0 shrink-0 overflow-y-auto overscroll-contain lg:block lg:w-[300px]">
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
              blockerDetails={[]}
              onSectionClick={scrollToSection}
              onBlockerClick={(blocker) => focusField(blocker.sectionId, blocker.targetId)}
              onGenerate={onOpenDrafting}
              generateLabel="Generate drafts →"
              activeSectionId={activeSection}
              pendingFiduciaries={pendingFiduciaries}
              layout="column"
            />
          </aside>
        </div>

            {/* Mobile summary rail */}
            <div className="mt-4 lg:hidden">
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
                blockerDetails={[]}
                onSectionClick={scrollToSection}
                onBlockerClick={(blocker) => focusField(blocker.sectionId, blocker.targetId)}
                onGenerate={onOpenDrafting}
                generateLabel="Generate drafts →"
                activeSectionId={activeSection}
                pendingFiduciaries={pendingFiduciaries}
                stickyTop={0}
              />
            </div>
        </div>
      </div>
    </DesignValidationProvider>
    </SharedFieldsProvider>
  )
}
