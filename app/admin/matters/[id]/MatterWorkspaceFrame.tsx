'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ExternalLink, Maximize2, Minimize2, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { ResponsiveDetailRail } from '@/components/layout/ResponsiveDetailRail'
import { MatterWorkspaceHeader } from '@/components/matter/MatterWorkspaceHeader'
import { MatterWorkspaceNav } from '@/components/matter/MatterWorkspaceNav'
import { RecordWorkIndicator } from '@/components/work/RecordWorkIndicator'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { matterTypeLabel } from '@/lib/matter/matterType'
import { matterWorkspaceHref } from '@/lib/matters/workspace'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import type { MatterWorkspaceFrameData } from '@/lib/matters/workspaceFrame'
import { MatterDetailsPanel } from './MatterDetailsPanel'
import { MatterDialogs } from './MatterDialogs'
import { MatterKeyDates } from './MatterKeyDates'
import { MatterStageStrip } from './MatterStageStrip'
import { ProbateStageStrip } from './ProbateStageStrip'
import { useMatterFacts } from './useMatterFacts'
import { useMatterHeaderActions } from './useMatterHeaderActions'
import { useMatterIntake } from './useMatterIntake'
import { useMatterStage } from './useMatterStage'
import { useCollapseOnScroll } from './useCollapseOnScroll'

const noop = () => {}

function typingInField(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/**
 * The matter workspace chrome for routes that are tabs of the matter but not
 * the matter page itself — today, Drafting. It renders the same header, stage
 * stepper, tab bar and Details panel as `/admin/matters/[id]`, with the
 * route's own page as the body. The body is rendered untouched.
 */
export function MatterWorkspaceFrame({ data, active, children }: {
  data: MatterWorkspaceFrameData
  active: 'drafting'
  children: ReactNode
}) {
  const token = useAccessToken()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // `?mode=focus` hides the app and matter chrome so the page fills the window;
  // a pop-out is the same URL in a new window. (`?focus=` belongs to the design sheet.)
  const focus = searchParams.get('mode') === 'focus'
  const setFocus = useCallback((on: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (on) params.set('mode', 'focus')
    else params.delete('mode')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])
  const popOut = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('mode', 'focus')
    window.open(`${pathname}?${params.toString()}`, '_blank', 'noopener')
  }

  // The header folds to one row once the page body (or the design sheet inside it) scrolls.
  const { ref: bodyRef, collapsed } = useCollapseOnScroll<HTMLDivElement>()

  useEffect(() => {
    if (!focus) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || typingInField(event.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      setFocus(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus, setFocus])
  const [matter, setMatter] = useState(data.matter)
  const matterId = matter.matter_id
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [composerChannel, setComposerChannel] = useState<'email' | 'sms' | null>(null)

  const facts = useMatterFacts({
    matterId, token, setMatter,
    initialDetails: data.details, initialMatterType: data.matterType, initialMatterNumber: data.matterNumber,
  })
  const intake = useMatterIntake({
    matterId, initialIntakeId: data.intakeId, initiallyCompleted: data.intakeCompleted, initialUploadCounts: data.uploadCounts,
  })
  const stage = useMatterStage({ matter, setMatter, token })
  const actions = useMatterHeaderActions({
    matter, setMatter, setMatterDetails: facts.setDetails, token,
    liveIntakeId: intake.liveIntakeId, setIntakeCompleted: intake.setIntakeCompleted,
  })
  const practiceArea = normalizePracticeArea(facts.details?.practice_area ?? matter.practice_area)

  return (
    <div className={focus
      ? 'fixed inset-0 z-40 flex flex-col bg-background text-foreground'
      : '-mx-4 -mb-4 flex h-full min-h-0 flex-col bg-background text-foreground md:-mx-6 md:-mb-6'}>
      {focus ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2 md:px-6">
          <p className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold">{matter.client_name || matter.matter_name || 'Matter'}</span><span className="text-muted-foreground"> · Drafting · focus mode</span></p>
          <Button type="button" size="sm" variant={detailsOpen ? 'selected' : 'outline'} aria-pressed={detailsOpen} onClick={() => setDetailsOpen(open => !open)}>
            <PanelRight className="size-4" aria-hidden />Details
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={popOut}><ExternalLink className="size-3.5" aria-hidden />New window</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setFocus(false)} title="Esc">
            <Minimize2 className="size-3.5" aria-hidden />Exit focus
          </Button>
        </div>
      ) : (
      <MatterWorkspaceHeader
        matter={matter}
        matterNumber={facts.matterNumber}
        planLabel={designPlanTypeLabel(data.designSheetPlanType ?? data.planMirror.planType) || null}
        matterTypeLabel={facts.matterType ? matterTypeLabel(facts.matterType) : null}
        intakeCompleted={intake.intakeCompleted}
        intakeId={intake.liveIntakeId}
        unlocking={actions.unlocking}
        factsRailOpen={detailsOpen}
        onToggleFactsRail={() => setDetailsOpen(open => !open)}
        onEmail={() => setComposerChannel('email')}
        onOpenIntake={() => void intake.openSheet()}
        onImportIntake={() => intake.setImportOpen(true)}
        onUnlockIntake={() => void actions.handleUnlockIntake()}
        onPushToLawmatics={() => void actions.pushToLawmatics()}
        pushingToLawmatics={actions.pushingToLawmatics}
        onPushToStatular={() => void actions.pushToStatular()}
        pushingToStatular={actions.pushingToStatular}
        onDelete={actions.deleteDialog.openDialog}
        onMerge={actions.mergeDialog.openDialog}
        collapsed={collapsed}
        stage={practiceArea === 'Probate' ? <ProbateStageStrip details={facts.details} /> : undefined}
        meta={<span className="flex flex-wrap items-center gap-2 pl-1">
          {practiceArea !== 'Probate' && <MatterStageStrip
            compact
            stage={matter.stage}
            details={facts.details}
            agingSummary={data.agingSummary}
            stageSaving={stage.stageSaving}
            onStageChange={next => void stage.handleStageChange(next)}
            history={data.stageHistory}
          />}
          <RecordWorkIndicator summary={data.workSummary} compact />
        </span>}
        extraActions={<>
          <Button type="button" size="sm" variant="outline" onClick={() => setFocus(true)} title="Hide the surrounding chrome so the page fills the window">
            <Maximize2 className="size-3.5" aria-hidden /><span className="hidden sm:inline">Focus</span>
          </Button>
          <Button type="button" size="sm" variant="outline" className="hidden sm:inline-flex" onClick={popOut} aria-label="Open in a new window" title="Open in a new window">
            <ExternalLink className="size-3.5" aria-hidden />
          </Button>
        </>}
        navigation={<MatterWorkspaceNav
          matterId={matterId}
          active={active}
          counts={{ tasks: data.taskCount, history: data.reviewBlockerCount, documents: intake.uploadCounts.total }}
          drafting={practiceArea !== 'Probate' && practiceArea !== 'TA'}
        />}
      />
      )}

      <div className="flex min-h-0 flex-1">
        <div ref={bodyRef} className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
        <ResponsiveDetailRail
          open={detailsOpen}
          onOpenChange={open => {
            if (!open && facts.savingField) return
            setDetailsOpen(open)
          }}
          label="Matter details"
          side="right"
          collapseBelow="lg"
          collapseWithAdminRail
          desktopClassName="w-[340px] border-l border-border bg-card"
          mobileClassName="bg-card"
        >
          <MatterDetailsPanel
            facts={{
              keyDates: <MatterKeyDates matterId={matterId} details={{ ...facts.details, signing_date: facts.details?.signing_date ?? matter.signing_date }} onSaveField={facts.saveField} />,
              matter,
              matterId,
              matterType: facts.matterType,
              matterTypeSaving: facts.matterTypeSaving,
              details: facts.details,
              designSheetPlanType: data.designSheetPlanType,
              planMirror: data.planMirror,
              // Last contact derives from the communications timeline, which this route does not load.
              lastContactAt: null,
              estate: data.estate,
              // The simplified panel shows no readiness dial, notes or activity.
              readinessItems: [],
              activity: [],
              noteText: '',
              onNoteTextChange: noop,
              onAddNote: noop,
              noteSaving: false,
              noteCount: 0,
              latestNoteAt: null,
              onSaveField: facts.saveField,
              onSaveMatterType: facts.saveMatterType,
              savingField: facts.savingField,
              lastSavedAt: facts.lastSavedAt,
              error: facts.error,
              onOpenTab: tab => router.push(matterWorkspaceHref(matterId, tab)),
            }}
            admin={{
              matterId,
              matterNumber: facts.matterNumber,
              matterNumberManual: data.matterNumberManual,
              matterStatus: matter.status ?? 'active',
              onStatusChange: status => void actions.handleStatusChange(status),
              statusSaving: actions.statusSaving,
              details: facts.details,
              onSaveField: facts.saveField,
              esignEnabled: data.esignEnabled,
              engagementSending: actions.sendingEngagement,
              onSendEngagement: () => void actions.handleSendEngagement(),
              onDraftEngagement: () => void actions.handleDraftEngagement(),
            }}
          />
        </ResponsiveDetailRail>
      </div>

      <MatterDialogs
        matter={matter}
        token={token}
        intake={{
          importOpen: intake.importOpen,
          setImportOpen: intake.setImportOpen,
          sheetOpen: intake.sheetOpen,
          setSheetOpen: intake.setSheetOpen,
          liveIntakeId: intake.liveIntakeId,
          setLiveIntakeId: intake.setLiveIntakeId,
          setIntakeCompleted: intake.setIntakeCompleted,
          clientUserId: data.clientUserId,
          practiceArea: practiceAreaLabel(facts.details?.practice_area ?? matter.practice_area),
        }}
        deleteDialog={actions.deleteDialog}
        mergeDialog={actions.mergeDialog}
        unlock={{ open: actions.unlockConfirmOpen, setOpen: actions.setUnlockConfirmOpen, confirm: actions.confirmUnlockIntake }}
        stage={{
          preflight: stage.stagePreflight,
          setPreflight: stage.setStagePreflight,
          saving: stage.stageSaving,
          confirm: preflight => void stage.handleStageChange(preflight.stage, {
            version: preflight.version,
            blockerKeys: preflight.blockers.map(blocker => blocker.key),
          }),
        }}
        composer={{ channel: composerChannel, setChannel: setComposerChannel }}
      />
    </div>
  )
}
