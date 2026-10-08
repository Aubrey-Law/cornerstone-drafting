'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
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

const noop = () => {}

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
    <div className="-mx-4 -mb-4 flex h-full min-h-0 flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
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
        stage={practiceArea === 'Probate' ? (
          <ProbateStageStrip details={facts.details} />
        ) : (
          <MatterStageStrip
            stage={matter.stage}
            details={facts.details}
            agingSummary={data.agingSummary}
            stageSaving={stage.stageSaving}
            onStageChange={next => void stage.handleStageChange(next)}
            history={data.stageHistory}
          />
        )}
        navigation={<MatterWorkspaceNav
          matterId={matterId}
          active={active}
          counts={{ tasks: data.taskCount, reviews: data.reviewBlockerCount, documents: intake.uploadCounts.total }}
          drafting={practiceArea !== 'Probate' && practiceArea !== 'TA'}
        />}
      />
      <div className="shrink-0 border-b border-border bg-card px-4 py-2 md:px-6">
        <RecordWorkIndicator summary={data.workSummary} compact />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</div>
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
              matter,
              matterId,
              matterNumber: facts.matterNumber,
              matterNumberManual: data.matterNumberManual,
              matterStatus: matter.status ?? 'active',
              onStatusChange: status => void actions.handleStatusChange(status),
              statusSaving: actions.statusSaving,
              details: facts.details,
              designSheetPlanType: data.designSheetPlanType,
              onSaveField: facts.saveField,
              savingField: facts.savingField,
              lastSavedAt: facts.lastSavedAt,
              error: facts.error,
              esignEnabled: data.esignEnabled,
              engagementSending: actions.sendingEngagement,
              onSendEngagement: () => void actions.handleSendEngagement(),
              onDraftEngagement: () => void actions.handleDraftEngagement(),
            }}
            onOpenIntake={() => void intake.openSheet()}
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
