'use client'

import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import '@/app/intake/guided.css'
import { designFieldTargetId, type DesignSectionSummary } from '@/lib/designSheetReadiness'
import { cn } from '@/lib/utils'
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
  guidedEmbeddedPageStyle,
  guidedPageStyle,
  type GuidedSaveStatus,
} from '@/components/guided'
import { Button } from '@/components/ui/button'
import { DesignValidationProvider } from './sections/shared'
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
  /** When null, show the section overview. Otherwise show that section as its own page. */
  activeSectionId?: string | null
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
  activeSectionId = null,
  initialFocus = null,
}: DesignSheetShellProps) {
  const router = useRouter()
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

  const [importDialogOpen, setImportDialogOpen] = useState(false)

  const summaries = useMemo<Record<string, DesignSectionSummary>>(() => ({
    ...sectionSummaries,
    'intake-review': intakeSnapshot
      ? { status: 'complete', detail: 'read-only' }
      : { status: 'none', detail: 'no intake data' },
  }), [intakeSnapshot, sectionSummaries])

  const pct = readinessTotal > 0
    ? Math.round((readinessCompletedCount / readinessTotal) * 100)
    : 0

  const lastName = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/).pop() ?? ''
  const includesTrust = designPlanTypeIncludesTrust(sheet.plan_type) || documentInclusions.trust

  const selectedDocKeys = useMemo(
    () => (Object.keys(documentInclusions) as Array<keyof DesignDocumentInclusions>)
      .filter((k): k is DesignDocumentKey => k !== 'spouse_docs' && documentInclusions[k]),
    [documentInclusions],
  )

  const clientDisplayName = [matter.client_name, matter.spouse_name].filter(Boolean).join(' & ')
  const matterLabel = `${matter.matter_name || 'Matter'} · ${clientDisplayName}`

  const sectionDefs = useMemo(
    () => buildDesignSectionDefs({
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
      handlePlanCoverageChange,
    }),
    [
      contactsState,
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
    ],
  )

  const visibleSections = useMemo(() => visibleDesignSections(sectionDefs), [sectionDefs])
  const resolvedSectionId = resolveDesignSectionId(sectionDefs, activeSectionId)
  const activeSection = resolvedSectionId
    ? visibleSections.find(section => section.id === resolvedSectionId) ?? null
    : null
  const activeIndex = activeSection ? visibleSections.findIndex(section => section.id === activeSection.id) : -1

  const summarySections = useMemo(
    () => buildSummarySectionItems(summaries, documentInclusions, intakeSnapshot),
    [documentInclusions, intakeSnapshot, summaries],
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
    if (embedded) {
      const params = new URLSearchParams(window.location.search)
      params.set('step', 'design')
      params.set('section', sectionId)
      if (focus?.targetField) params.set('focus', `${focus.sectionId}:${focus.targetField}`)
      else params.delete('focus')
      router.push(`/admin/drafting/${matterId}?${params.toString()}`, { scroll: false })
      return
    }
    router.push(designSectionHref(matterId, sectionId, false))
  }, [embedded, matterId, router])

  const initialFocusHandled = useRef(false)
  useEffect(() => {
    if (!initialFocus || initialFocusHandled.current || !activeSection) return
    if (initialFocus.sectionId !== activeSection.id) return
    initialFocusHandled.current = true
    const targetId = initialFocus.targetField ? designFieldTargetId(initialFocus.targetField) : null
    requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : document.getElementById(`design-section-${activeSection.id}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (target instanceof HTMLElement && targetId) {
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
                  <Link href={`/admin/drafting/${matterId}?step=design`}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to workspace
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
                {activeSection ? (
                  <DesignSectionPageView
                    section={activeSection}
                    sectionIndex={activeIndex}
                    sectionTotal={visibleSections.length}
                    summary={summaries[activeSection.id]}
                    overviewHref={overviewHref}
                    previousHref={previousHref}
                    nextHref={nextHref}
                  />
                ) : (
                  <DesignSectionOverview
                    title={introTitle}
                    subtitle="Open one section at a time. Required fields gate document generation — your selections control which drafts are produced."
                    pct={pct}
                    sections={visibleSections}
                    summarySections={summarySections}
                    sectionHref={sectionHref}
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
                  onBlockerClick={(blocker) => navigateToSection(blocker.sectionId, blocker)}
                  onGenerate={onOpenDrafting}
                  generateLabel="Generate drafts →"
                  generateDisabled={!readinessComplete}
                  generateDisabledTitle={draftBlockers.length ? `Complete: ${draftBlockers.join(', ')}` : undefined}
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
                onBlockerClick={(blocker) => navigateToSection(blocker.sectionId, blocker)}
                onGenerate={onOpenDrafting}
                generateLabel="Generate drafts →"
                generateDisabled={!readinessComplete}
                generateDisabledTitle={draftBlockers.length ? `Complete: ${draftBlockers.join(', ')}` : undefined}
                pendingFiduciaries={pendingFiduciaries}
                activeSectionId={resolvedSectionId ?? undefined}
                stickyTop={0}
              />
            </div>
          </div>
        </div>
      </div>
    </DesignValidationProvider>
  )
}
