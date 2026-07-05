'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { DollarSign, FileText, Heart, HeartPulse, Hop as Home, Landmark, Lightbulb, ScrollText, Shield, Target, User, Scale } from 'lucide-react'
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
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import { designPlanTypeLabel, designPlanTypeIncludesTrust } from '@/lib/designPlanType'
import type { DesignDocumentInclusions, DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import { useDesignSheetState, type LpData } from '@/lib/designSheet/useDesignSheetState'
import { DesignValidationProvider, AccordionBadge } from './sections/shared'
import { PersonalSection } from './sections/PersonalSection'
import { FamilySection } from './sections/FamilySection'
import { PlanDesignSection } from './sections/PlanDesignSection'
import { AssetsSection } from './sections/AssetsSection'
import { GoalsSection } from './sections/GoalsSection'
import { ResiduarySection } from './sections/ResiduarySection'
import {
  DeedDocumentSection, DpoaDocumentSection, HealthCareDocumentSection,
  TrustDocumentSection, WillDocumentSection,
} from './sections/DocumentSections'
import { IntakeSection } from './sections/IntakeSection'
import type { PipelineMatter, DesignSheet, MatterContact } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

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
}

interface SectionDef {
  id: string
  label: string
  icon: React.ElementType
  render: () => React.ReactNode
  badge?: React.ReactNode
}

/**
 * Streamlined attorney design sheet. Optimised for fast top-to-bottom entry:
 * every section is always expanded in one scrollable column, the right summary
 * rail tracks position and jumps between sections, and there is no client-approval
 * surface. Shares all save/validation behaviour with the guided DesignSheetShell
 * via useDesignSheetState.
 */
export default function ExpressDesignSheet({
  matterId,
  matter,
  contacts,
  sheet: sheetProp,
  lpData,
  intakeSnapshot,
  onOpenDrafting,
  initialFocus = null,
}: ExpressDesignSheetProps) {
  const s = useDesignSheetState({ matterId, matter, contacts, sheet: sheetProp, lpData, applyDefaults: true })
  const {
    isLP, sheet, updateField, validationValue, saveStatus, saveStatusText,
    contactsState, handleAddContact, handleUpdateContact,
    lpDataState, updateLpPatch, handlePlanCoverageChange, handleExportDesignSheet, handleImportedDesignSheetFields,
    handleSave, isPending, exporting, documentInclusions, sectionSummaries,
    blockerDetails, draftBlockers, readinessComplete, readinessCompletedCount, readinessTotal,
  } = s

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('plan-design')
  const sectionEls = useRef<Record<string, HTMLElement | null>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const clientDisplayName = [matter.client_name, matter.spouse_name].filter(Boolean).join(' & ') || 'Unnamed client'

  // ── Section definitions (single source for rail + body) ──────────────────────
  const sections = useMemo<SectionDef[]>(() => {
    const list: SectionDef[] = []
    if (intakeSnapshot) {
      list.push({
        id: 'intake-review', label: 'Intake Review', icon: FileText,
        badge: <Badge className="border-0 bg-muted text-[10px] font-medium text-muted-foreground">Read-only</Badge>,
        render: () => <IntakeSection intake={intakeSnapshot} />,
      })
    }
    list.push({ id: 'plan-design', label: 'Plan Design', icon: Lightbulb,
      badge: <AccordionBadge variant={isLP ? 'lp' : 'core'}>{isLP ? 'EP-LP' : 'EP'}</AccordionBadge>,
      render: () => <PlanDesignSection sheet={sheet} onChange={updateField} contacts={contactsState} onAddContact={handleAddContact} onUpdateContact={handleUpdateContact}
        isLP={isLP} planCoverage={(lpDataState?.li_plan_coverage as 'no_trust' | 'trust_included') ?? 'no_trust'} onPlanCoverageChange={handlePlanCoverageChange} /> })
    list.push({ id: 'goals-notes', label: 'Goals & Notes', icon: Target,
      render: () => <GoalsSection sheet={sheet} onChange={updateField} /> })
    list.push({ id: 'personal', label: 'Personal', icon: User,
      render: () => <PersonalSection sheet={sheet} onChange={updateField} /> })
    list.push({ id: 'family', label: 'Family', icon: Heart,
      render: () => <FamilySection sheet={sheet} onChange={updateField} /> })
    list.push({ id: 'assets', label: 'Assets', icon: DollarSign,
      render: () => <AssetsSection sheet={sheet} onChange={updateField} /> })
    if (documentInclusions.trust) {
      list.push({ id: 'trust', label: 'Trust', icon: Landmark, render: () => (
        <TrustDocumentSection sheet={sheet} onChange={updateField} contacts={contactsState}
          matter={matter} onAddContact={handleAddContact} onUpdateContact={handleUpdateContact} />
      ) })
    }
    if (documentInclusions.will) {
      list.push({ id: 'will', label: 'Will', icon: ScrollText, render: () => (
        <>
          <WillDocumentSection sheet={sheet} onChange={updateField} contacts={contactsState}
            matter={matter} onAddContact={handleAddContact} onUpdateContact={handleUpdateContact} />
          {isLP && (
            <div className="mt-6 border-t border-border pt-6">
              <div className="mb-4 flex items-center gap-2">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <span className="text-[13px] font-semibold text-foreground">Residuary Estate</span>
                <AccordionBadge variant="lp">LP</AccordionBadge>
              </div>
              <ResiduarySection lpData={lpDataState?.li_design_sheet_data ?? {}} onChange={updateLpPatch} />
            </div>
          )}
        </>
      ) })
    }
    if (documentInclusions.dpoa) {
      list.push({ id: 'dpoa', label: 'Durable POA', icon: Shield, render: () => (
        <DpoaDocumentSection sheet={sheet} onChange={updateField} contacts={contactsState}
          matter={matter} onAddContact={handleAddContact} onUpdateContact={handleUpdateContact} />
      ) })
    }
    if (documentInclusions.healthcare) {
      list.push({ id: 'healthcare', label: 'Health Care', icon: HeartPulse, render: () => (
        <HealthCareDocumentSection sheet={sheet} onChange={updateField} contacts={contactsState}
          matter={matter} onAddContact={handleAddContact} onUpdateContact={handleUpdateContact} />
      ) })
    }
    if (documentInclusions.deed) {
      list.push({ id: 'deed', label: 'Deed', icon: Home,
        render: () => <DeedDocumentSection sheet={sheet} onChange={updateField} /> })
    }
    return list
  }, [intakeSnapshot, isLP, documentInclusions, sheet, updateField, contactsState, matter,
      handleAddContact, handleUpdateContact, lpDataState, updateLpPatch, handlePlanCoverageChange])

  // ── Scroll-spy: highlight the section nearest the top of the scroll area ─────
  // Keyed on the section id set (not the section objects, which change on every
  // keystroke) so the observer only re-subscribes when sections appear/disappear.
  const sectionIdsKey = sections.map(s => s.id).join(',')
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
  const includesTrust = designPlanTypeIncludesTrust(sheet.plan_type) || documentInclusions.trust
  const trustName = lastName
    ? includesTrust ? `The ${lastName} Family Trust` : `The ${lastName} Family Plan`
    : matter.matter_name || 'Estate plan design'
  const peopleLine = clientDisplayName || sheet.client_name || 'Client'
  const selectedDocKeys = (Object.keys(documentInclusions) as Array<keyof DesignDocumentInclusions>)
    .filter((k): k is DesignDocumentKey => k !== 'spouse_docs' && documentInclusions[k])
  const summarySections = useMemo<SummarySectionItem[]>(
    () => sections.map((s) => ({
      id: s.id,
      label: s.label,
      status: sectionSummaries[s.id]?.status ?? 'none',
    })),
    [sections, sectionSummaries],
  )

  return (
    <DesignValidationProvider value={validationValue}>
      <div className="guided-interview flex h-full min-h-0 flex-col overflow-hidden">
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
                onImport={() => setImportDialogOpen(true)}
                onSave={handleSave}
                onExport={handleExportDesignSheet}
                saveLabel={saveStatus === 'dirty' ? 'Save' : 'Saved'}
                saving={saveStatus === 'saving'}
                exporting={exporting}
                pending={isPending}
                saveDirty={saveStatus === 'dirty'}
              />
            )}
          />

          <div className="mb-4 px-1">
            <GuidedIntroCard
              pct={pct}
              title={lastName ? `Fast entry — ${lastName} family plan` : 'Fast entry design sheet'}
              subtitle="All sections stay expanded. Use the summary rail to jump between sections and track readiness."
            />
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
              {/* Readiness banner with jump-to-field pills */}
              {!readinessComplete && blockerDetails.length > 0 && (
                <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Design Readiness</p>
                      <p className="mt-1 text-[13px] text-foreground">
                        <span className="font-semibold">{readinessCompletedCount}/{readinessTotal}</span> required sections ready —
                        complete the fields below to unlock drafting.
                      </p>
                    </div>
                    <Badge className="border-0 bg-warning/10 text-[11px] font-medium text-warning">Needs Attention</Badge>
                  </div>
                  <div className="mt-3 space-y-2.5">
                    {blockerDetails.map(blocker => (
                      <div key={blocker.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-baseline sm:gap-3">
                        <button
                          type="button"
                          onClick={() => scrollToSection(blocker.id)}
                          className="shrink-0 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-warning hover:underline sm:w-32"
                        >
                          {blocker.label}
                        </button>
                        <div className="flex flex-wrap gap-1.5">
                          {blocker.blockers.map(item => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => focusField(item.sectionId, item.targetId)}
                              className={cn(
                                'rounded-full border px-2.5 py-1 text-[11px] text-foreground transition-colors',
                                item.category === 'client-decision'
                                  ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-700/50 dark:bg-amber-950/30'
                                  : 'border-warning/40 bg-card hover:bg-warning/10',
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section cards — always open */}
              {sections.map(item => (
                <section
                  key={item.id}
                  id={item.id}
                  ref={setSectionEl(item.id)}
                  className="mb-4 scroll-mt-24"
                  style={{
                    borderRadius: 14,
                    border: '1px solid var(--gi-border)',
                    background: 'var(--gi-surface)',
                    boxShadow: '0 1px 2px rgba(15,23,42,.04)',
                  }}
                >
                  <div className="flex items-center gap-3 border-b px-[1.125rem] py-[0.8rem]" style={{ borderColor: 'var(--gi-divider)' }}>
                    <span className="flex h-[1.75rem] w-[1.75rem] shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(26,107,114,.1)' }}>
                      <item.icon className="h-4 w-4" style={{ color: 'var(--gi-teal)' }} />
                    </span>
                    <span className="flex-1 text-[0.875rem] font-medium" style={{ color: 'var(--gi-ink)' }}>
                      {item.label}
                    </span>
                    {item.badge}
                  </div>
                  <div className="px-[1.125rem] py-5">
                    {item.render()}
                  </div>
                </section>
              ))}
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
              blockerDetails={blockerDetails}
              onSectionClick={scrollToSection}
              onBlockerClick={(blocker) => focusField(blocker.sectionId, blocker.targetId)}
              onGenerate={onOpenDrafting}
              generateLabel="Generate drafts →"
              generateDisabled={!readinessComplete}
              generateDisabledTitle={draftBlockers.length ? `Complete: ${draftBlockers.join(', ')}` : undefined}
              activeSectionId={activeSection}
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
                blockerDetails={blockerDetails}
                onSectionClick={scrollToSection}
                onBlockerClick={(blocker) => focusField(blocker.sectionId, blocker.targetId)}
                onGenerate={onOpenDrafting}
                generateLabel="Generate drafts →"
                generateDisabled={!readinessComplete}
                generateDisabledTitle={draftBlockers.length ? `Complete: ${draftBlockers.join(', ')}` : undefined}
                activeSectionId={activeSection}
                stickyTop={0}
              />
            </div>
        </div>
      </div>
    </DesignValidationProvider>
  )
}
