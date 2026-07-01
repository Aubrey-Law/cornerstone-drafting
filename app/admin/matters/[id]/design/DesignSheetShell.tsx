'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { ArrowLeft, Scale } from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import '@/app/intake/guided.css'
import { cn } from '@/lib/utils'
import { designFieldTargetId, type DesignSectionSummary } from '@/lib/designSheetReadiness'
import { designPlanTypeLabel, designPlanTypeIncludesTrust } from '@/lib/designPlanType'
import {
  type DesignDocumentInclusions,
  type DesignDocumentKey,
} from '@/lib/designSheetDocumentInclusions'
import { useDesignSheetState } from '@/lib/designSheet/useDesignSheetState'
import {
  BrandBar,
  DesignSummaryRail,
  DesignToolbarActions,
  GuidedIntroCard,
  guidedEmbeddedPageStyle,
  guidedPageStyle,
  type GuidedSaveStatus,
  type SummarySectionItem,
} from '@/components/guided'
import type { GuidedSectionHandle } from '@/components/intake/GuidedSection'
import { Button } from '@/components/ui/button'
import { AccordionBadge, SectionPlaceholder, DesignValidationProvider } from './sections/shared'
import { PersonalSection } from './sections/PersonalSection'
import { FamilySection } from './sections/FamilySection'
import { PlanDesignSection } from './sections/PlanDesignSection'
import { AssetsSection } from './sections/AssetsSection'
import { GoalsSection } from './sections/GoalsSection'
import { ResiduarySection } from './sections/ResiduarySection'
import {
  DeedDocumentSection,
  DpoaDocumentSection,
  HealthCareDocumentSection,
  TrustDocumentSection,
  WillDocumentSection,
} from './sections/DocumentSections'
import { IntakeSection } from './sections/IntakeSection'
import { GuidedDesignSections, type DesignSectionDef } from './GuidedDesignSections'
import type { PipelineMatter, DesignSheet, MatterContact } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'

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
  initialFocus?: { sectionId: string; targetField: string | null } | null
}

function mapSaveStatus(status: 'saved' | 'dirty' | 'saving'): GuidedSaveStatus {
  return status
}

export default function DesignSheetShell({
  matterId,
  matter,
  contacts,
  sheet: sheetProp,
  lpData,
  intakeSnapshot,
  embedded = false,
  onOpenDrafting,
  initialFocus = null,
}: DesignSheetShellProps) {
  const s = useDesignSheetState({ matterId, matter, contacts, sheet: sheetProp, lpData })
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
    lpDataState,
    updateLpPatch,
    handlePlanCoverageChange,
    handleImportedDesignSheetFields,
    handleExportDesignSheet,
    documentInclusions,
    sectionSummaries,
    blockerDetails,
    draftBlockers,
    readinessComplete,
    readinessCompletedCount,
    readinessTotal,
  } = s

  const [openSection, setOpenSection] = useState('plan-design')
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const sectionRefs = useRef<Record<string, GuidedSectionHandle | null>>({})

  const summaries = useMemo<Record<string, DesignSectionSummary>>(() => ({
    ...sectionSummaries,
    'intake-review': intakeSnapshot
      ? { status: 'complete' as const, detail: 'read-only' }
      : { status: 'none' as const, detail: 'no intake data' },
  }), [intakeSnapshot, sectionSummaries])

  const pct = readinessTotal > 0
    ? Math.round((readinessCompletedCount / readinessTotal) * 100)
    : 0

  const lastName = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/).pop() ?? ''
  const includesTrust = designPlanTypeIncludesTrust(sheet.plan_type) || documentInclusions.trust
  const trustName = lastName
    ? includesTrust ? `The ${lastName} Family Trust` : `The ${lastName} Family Plan`
    : matter.matter_name || 'Estate plan design'

  const clientDisplayName = [matter.client_name, matter.spouse_name].filter(Boolean).join(' & ')
  const peopleLine = [
    clientDisplayName || sheet.client_name || 'Client',
    sheet.spouse_name ? `spouse: ${sheet.spouse_name}` : '',
  ].filter(Boolean).join(' · ')

  const selectedDocKeys = useMemo(
    () => (Object.keys(documentInclusions) as Array<keyof DesignDocumentInclusions>)
      .filter((k): k is DesignDocumentKey => k !== 'spouse_docs' && documentInclusions[k]),
    [documentInclusions],
  )

  const matterLabel = `${matter.matter_name || 'Matter'} · ${clientDisplayName}`

  const summarySections = useMemo<SummarySectionItem[]>(() => {
    const defs: SummarySectionItem[] = []
    if (intakeSnapshot) defs.push({ id: 'intake-review', label: 'Intake Review', status: 'complete' })
    defs.push(
      { id: 'plan-design', label: 'Document Selection', status: summaries['plan-design']?.status ?? 'none' },
      { id: 'personal', label: 'Family Information', status: summaries.personal?.status ?? 'none' },
      { id: 'family', label: 'Children & Guardians', status: summaries.family?.status ?? 'none' },
    )
    if (documentInclusions.trust) {
      defs.push({ id: 'trust', label: 'Living Trust Details', status: summaries.trust?.status ?? 'none' })
    }
    defs.push({ id: 'assets', label: 'Asset Schedules', status: summaries.assets?.status ?? 'none' })
    if (documentInclusions.dpoa) {
      defs.push({ id: 'dpoa', label: 'Powers of Attorney', status: summaries.dpoa?.status ?? 'none' })
    }
    if (documentInclusions.healthcare) {
      defs.push({ id: 'healthcare', label: 'Health Care & Directives', status: summaries.healthcare?.status ?? 'none' })
    }
    defs.push({ id: 'dementia-directive', label: 'Dementia Directive', status: 'none' })
    if (documentInclusions.will) {
      defs.push({ id: 'will', label: 'Executors & Will', status: summaries.will?.status ?? 'none' })
    }
    if (documentInclusions.deed) {
      defs.push({ id: 'deed', label: 'Deeds', status: summaries.deed?.status ?? 'none' })
    }
    defs.push(
      { id: 'transfers-assignments', label: 'Transfers & Assignments', status: 'none' },
      { id: 'goals-notes', label: 'Attorney Notes', status: summaries['goals-notes']?.status ?? 'none' },
    )
    return defs
  }, [documentInclusions, intakeSnapshot, summaries])

  const pendingFiduciaries = useMemo(() => {
    const states = sheet.fiduciary_slot_states ?? {}
    return Object.entries(states)
      .filter(([, v]) => v === 'pending_client')
      .map(([key]) => key)
  }, [sheet.fiduciary_slot_states])

  const focusDesignTarget = useCallback((sectionId: string, targetId: string | null) => {
    setOpenSection(sectionId)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!targetId) {
          sectionRefs.current[sectionId]?.scrollIntoView()
          return
        }
        const target = document.getElementById(targetId)
        sectionRefs.current[sectionId]?.scrollIntoView()
        if (target instanceof HTMLElement) {
          target.focus({ preventScroll: true })
          target.classList.add('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
          window.setTimeout(() => {
            target.classList.remove('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-background')
          }, 1600)
        }
      })
    })
  }, [])

  const handleNavClick = useCallback((sectionId: string) => {
    focusDesignTarget(sectionId, null)
  }, [focusDesignTarget])

  const handleToggle = useCallback((sectionId: string) => {
    setOpenSection(prev => prev === sectionId ? '' : sectionId)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sectionRefs.current[sectionId]?.scrollIntoView()
      })
    })
  }, [])

  const initialFocusHandled = useRef(false)
  useEffect(() => {
    if (!initialFocus || initialFocusHandled.current) return
    initialFocusHandled.current = true
    const targetId = initialFocus.targetField ? designFieldTargetId(initialFocus.targetField) : null
    focusDesignTarget(initialFocus.sectionId, targetId)
  }, [initialFocus, focusDesignTarget])

  const sectionDefs = useMemo<DesignSectionDef[]>(() => {
    const common = {
      sheet,
      onChange: updateField,
      contacts: contactsState,
      onAddContact: handleAddContact,
      onUpdateContact: handleUpdateContact,
    }
    const list: DesignSectionDef[] = []

    if (intakeSnapshot) {
      list.push({
        id: 'intake-review',
        title: 'Intake Review',
        subtitle: 'Client answers (read-only)',
        render: () => <IntakeSection intake={intakeSnapshot} />,
      })
    }

    list.push(
      {
        id: 'plan-design',
        title: 'Document Selection',
        subtitle: `${selectedDocKeys.length} document${selectedDocKeys.length === 1 ? '' : 's'} selected`,
        render: () => (
          <PlanDesignSection
            {...common}
            isLP={isLP}
            planCoverage={(lpDataState?.li_plan_coverage as 'no_trust' | 'trust_included') ?? 'no_trust'}
            onPlanCoverageChange={handlePlanCoverageChange}
          />
        ),
      },
      {
        id: 'personal',
        title: 'Family Information',
        render: () => <PersonalSection sheet={sheet} onChange={updateField} />,
      },
      {
        id: 'family',
        title: 'Children & Guardians',
        render: () => <FamilySection sheet={sheet} onChange={updateField} />,
      },
    )

    if (documentInclusions.trust) {
      list.push({
        id: 'trust',
        title: 'Living Trust Details',
        render: () => (
          <TrustDocumentSection {...common} matter={matter} />
        ),
      })
    }

    list.push({
      id: 'assets',
      title: 'Asset Schedules',
      render: () => <AssetsSection sheet={sheet} onChange={updateField} />,
    })

    if (documentInclusions.dpoa) {
      list.push({
        id: 'dpoa',
        title: 'Powers of Attorney',
        render: () => <DpoaDocumentSection {...common} matter={matter} />,
      })
    }

    if (documentInclusions.healthcare) {
      list.push({
        id: 'healthcare',
        title: 'Health Care & Directives',
        render: () => <HealthCareDocumentSection {...common} matter={matter} />,
      })
    }

    list.push({
      id: 'dementia-directive',
      title: 'Dementia Directive',
      subtitle: 'Planned — capture notes under Attorney Notes for now',
      render: () => (
        <SectionPlaceholder
          title="Dementia Directive"
          note="Dementia-directive preferences and instructions will be captured here in a later phase. For now, note any client wishes under Attorney Notes."
        />
      ),
    })

    if (documentInclusions.will) {
      list.push({
        id: 'will',
        title: 'Executors & Will',
        render: () => (
          <>
            <WillDocumentSection {...common} matter={matter} />
            {isLP && (
              <div className="mt-6 border-t border-border pt-6">
                <div className="mb-4 flex items-center gap-2">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                  <span className="text-[13px] font-semibold text-foreground">Residuary Estate</span>
                  <AccordionBadge variant="lp">LP</AccordionBadge>
                </div>
                <ResiduarySection
                  lpData={lpDataState?.li_design_sheet_data ?? {}}
                  onChange={updateLpPatch}
                />
              </div>
            )}
          </>
        ),
      })
    }

    if (documentInclusions.deed) {
      list.push({
        id: 'deed',
        title: 'Deeds',
        render: () => <DeedDocumentSection sheet={sheet} onChange={updateField} />,
      })
    }

    list.push(
      {
        id: 'transfers-assignments',
        title: 'Transfers & Assignments',
        subtitle: 'Planned',
        render: () => (
          <SectionPlaceholder
            title="Transfers & Assignments"
            note="Asset transfers to trust, beneficiary-designation changes, and assignment of personal property will be captured here in a later phase."
          />
        ),
      },
      {
        id: 'goals-notes',
        title: 'Attorney Notes',
        render: () => <GoalsSection sheet={sheet} onChange={updateField} />,
      },
    )

    return list
  }, [
    documentInclusions,
    handleAddContact,
    handlePlanCoverageChange,
    handleUpdateContact,
    intakeSnapshot,
    isLP,
    lpDataState,
    matter,
    selectedDocKeys.length,
    sheet,
    updateField,
    updateLpPatch,
    contactsState,
  ])

  const introTitle = lastName
    ? `Let's build the ${lastName} family plan`
    : "Let's finalize this estate plan design"

  return (
    <DesignValidationProvider value={validationValue}>
      <div className={cn('guided-interview flex min-h-0 flex-col', embedded ? 'h-full overflow-hidden' : 'h-full')}>
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
                  onImport={() => setImportDialogOpen(true)}
                  onSave={handleSave}
                  onExport={handleExportDesignSheet}
                  saveLabel={saveStatus === 'dirty' ? 'Save Changes' : 'Saved'}
                  saving={saveStatus === 'saving'}
                  exporting={exporting}
                  pending={isPending}
                  saveDirty={saveStatus === 'dirty'}
                />
              )}
            />

            {/* Mobile section pills */}
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
              {summarySections.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium',
                    openSection === item.id
                      ? 'border-[var(--gi-teal)] bg-[rgba(26,107,114,.08)] text-[var(--gi-teal)]'
                      : 'border-[var(--gi-border)] text-[var(--gi-muted)]',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

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
              <main style={{ flex: 3, minWidth: 'min(520px, 100%)', display: 'flex', flexDirection: 'column', gap: 18, ...(embedded ? { minHeight: 0, overflowY: 'auto' } : {}) }}>
                <GuidedIntroCard
                  pct={pct}
                  title={introTitle}
                  subtitle="Complete each section below. Required fields gate document generation — your selections control which drafts are produced."
                />
                <GuidedDesignSections
                  sections={sectionDefs}
                  summaries={summaries}
                  openSection={openSection}
                  onToggle={handleToggle}
                  sectionRefs={sectionRefs}
                />
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
                  onSectionClick={handleNavClick}
                  onBlockerClick={(blocker) => focusDesignTarget(blocker.sectionId, blocker.targetId)}
                  onGenerate={onOpenDrafting}
                  generateLabel="Generate drafts →"
                  generateDisabled={!readinessComplete}
                  generateDisabledTitle={draftBlockers.length ? `Complete: ${draftBlockers.join(', ')}` : undefined}
                  pendingFiduciaries={pendingFiduciaries}
                  activeSectionId={openSection}
                  layout={embedded ? 'column' : 'sticky'}
                />
              </div>
            </div>

            {/* Mobile summary + CTA */}
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
                onSectionClick={handleNavClick}
                onBlockerClick={(blocker) => focusDesignTarget(blocker.sectionId, blocker.targetId)}
                onGenerate={onOpenDrafting}
                generateLabel="Generate drafts →"
                generateDisabled={!readinessComplete}
                generateDisabledTitle={draftBlockers.length ? `Complete: ${draftBlockers.join(', ')}` : undefined}
                pendingFiduciaries={pendingFiduciaries}
                activeSectionId={openSection}
                stickyTop={0}
              />
            </div>
          </div>
        </div>
      </div>
    </DesignValidationProvider>
  )
}
