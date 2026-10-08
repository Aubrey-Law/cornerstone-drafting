'use client'
import Link from 'next/link'
import { usePrimaryReady } from '@/app/admin/components/NavigationTiming'

import { listenForMatterContacts } from '@/lib/matters/contactEvents'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { useConfirm } from '@/components/useConfirm'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import type { MatterActivity, MatterContact, PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { matterTypeLabel, type MatterType } from '@/lib/matter/matterType'
import { designPlanTypeLabel } from '@/lib/designPlanType'
import { EMPTY_PLAN_MIRROR, type MatterPlanMirror } from '@/lib/matter/planMirror'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import type { MatterTab } from '@/lib/matterPageTabs'
import { ViewSwitch } from '@/components/ViewSwitch'
import type { UnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { RecordTasksTab, TASK_VIEW_OPTIONS } from '@/components/tasks/RecordTasksTab'
import { useRecordTaskCounts } from '@/components/tasks/useRecordTaskCounts'
import type { RecordTaskCounts } from '@/lib/tasks/types'
import { MatterProbateEssentialsCard } from './MatterProbateEssentialsCard'
import { useMatterDetailsSave } from './useMatterDetailsSave'
import { MatterActivityTab } from './MatterActivityTab'
import { MatterReviewsTab } from './MatterReviewsTab'
import { RecordTabHeader } from '@/components/RecordTabHeader'
import { MatterAssetsTabContent } from './MatterOverviewAssets'
import { MatterMeetingNotesCard } from './MatterMeetingNotesCard'
import { MatterStageHistoryCard } from './MatterStageHistoryCard'
import type { MatterStageHistoryEntry } from '@/lib/matters/stageTimeline'
import { MatterPeopleTab } from './MatterPeopleTab'
import { useMatterNotes } from './useMatterNotes'
import { useMatterEngineStageTask } from './useMatterEngineStageTask'
import { MatterNotesTab, type LinkedMatterNote } from './tabs/notes'
import { MatterCommunicationsTab } from './tabs/messages'
import { MatterBillingTab } from './tabs/billing'
import { MatterEngineStageTaskCard } from '@/components/admin/MatterEngineStageTaskCard'
import { MatterOverviewSidebar } from './MatterOverviewSidebar'
import { MatterKeyDates } from './MatterKeyDates'
import { MatterOverviewComposer } from './MatterOverviewComposer'
import { MatterOverviewWork } from './MatterOverviewWork'
import { MatterWorkspaceHeader } from '@/components/matter/MatterWorkspaceHeader'
import { MatterDetailsPanel } from './MatterDetailsPanel'
import { MatterDialogs } from './MatterDialogs'
import { MatterDocumentsWorkspace } from './MatterDocumentsWorkspace'
import { ResponsiveDetailRail } from '@/components/layout/ResponsiveDetailRail'
import { MatterStageStrip } from './MatterStageStrip'
import { ProbateStageStrip } from './ProbateStageStrip'
import { EstateLedgerCard } from './EstateLedgerCard'
import { buildMatterReadinessItems } from './MatterReadinessDial'
import { useMatterCommunications } from './useMatterCommunications'
import { useMatterActivity } from './useMatterActivity'
import { useMatterIntake } from './useMatterIntake'
import { useMatterStage } from './useMatterStage'
import { useMatterHeaderActions } from './useMatterHeaderActions'
import { useMatterTabs } from './useMatterTabs'
import { useLinkedMatterNotes, type LeadNoteRow } from './useLinkedMatterNotes'
import { MatterWorkspaceNav } from '@/components/matter/MatterWorkspaceNav'

interface MatterDetailClientProps {
  matter: PipelineMatter
  matterId: string
  contacts: MatterContact[]
  agingSummary?: MatterAgingSummary | null
  intakeId?: string | null
  clientIntakeRow?: {
    id: string
    intake_sent_at: string | null
    intake_completed_at: string | null
    email: string | null
    first_name: string | null
    status?: string | null
    user_id?: string | null
    client_user_id?: string | null
    unlock_requested_at?: string | null
    unlock_request_note?: string | null
  } | null
  matterNumber?: string | null
  matterNumberManual?: boolean
  initialMatterType?: MatterType | null
  matterDetails?: MatterDetailsRow | null
  designSheetPlanType?: string | null
  planMirror?: MatterPlanMirror
  initialEstateSnapshot: MatterEstateSnapshot
  initialNotes?: MatterNoteRow[]
  initialLeadNotes?: LeadNoteRow[]
  initialMatterLinkedNotes?: LinkedMatterNote[]
  initialActivity?: MatterActivity[]
  /** Where older matter activity starts, when the first page was full. */
  initialActivityCursor?: string | null
  initialStageHistory?: MatterStageHistoryEntry[]
  designSheetSeeded?: boolean
  reviewFlags?: IntakeReadinessFlag[]
  resyncPreviewCount?: number
  smsEnabled?: boolean
  emailSendEnabled?: boolean
  esignEnabled?: boolean
  /** firm_settings.esign_documents_enabled — sending a document for signature. */
  esignDocumentsEnabled?: boolean
  unreviewedUploadCounts?: UnreviewedUploadCounts
  initialTaskCounts?: RecordTaskCounts
  /** Undecided field-audit blocker findings, for the Reviews tab count. */
  reviewBlockerCount?: number
  taskPreview?: Array<{ key: string; title: string; href: string }>
  workSummary?: import('@/lib/work/recordSummary').RecordWorkSummary | null
}

export default function MatterDetailClient(props: MatterDetailClientProps) {
  return (
    <Suspense fallback={<MatterDetailShell {...props} />}>
      <MatterDetailClientInner {...props} />
    </Suspense>
  )
}

function MatterDetailShell({ matter }: MatterDetailClientProps) {
  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {matter.client_name || matter.matter_name || 'Matter'}
        </h1>
      </div>
      <div className="flex-1 px-4 py-4 md:px-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    </div>
  )
}

function MatterDetailClientInner({
  matter: initialMatter,
  matterId,
  contacts: initialContacts,
  agingSummary = null,
  intakeId: initialIntakeId = null,
  clientIntakeRow = null,
  matterNumber: initialMatterNumber = null,
  matterNumberManual = false,
  initialMatterType = null,
  matterDetails: initialMatterDetails = null,
  designSheetPlanType = null,
  planMirror = EMPTY_PLAN_MIRROR,
  initialEstateSnapshot,
  initialNotes = [],
  initialLeadNotes = [],
  initialMatterLinkedNotes = [],
  initialActivity = [],
  initialActivityCursor = null,
  initialStageHistory = [],
  designSheetSeeded = false,
  reviewFlags = [],
  smsEnabled = false,
  emailSendEnabled = false,
  esignEnabled = false,
  esignDocumentsEnabled = false,
  unreviewedUploadCounts: initialUnreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
  initialTaskCounts = { open: 0, overdue: 0 },
  reviewBlockerCount = 0,
  workSummary = null,
  taskPreview = [],
}: MatterDetailClientProps) {
  usePrimaryReady('Matter detail', matterId)
  const token = useAccessToken()
  const { confirm: confirmDelete, confirmDialog } = useConfirm()
  const router = useRouter()
  useEffect(() => listenForMatterContacts(matterId, () => router.refresh()), [matterId, router])
  const {
    activeTab, communicationChannel, taskView, assetView, documentView, documentScope, deepLinkedDocumentId,
    setActiveTab, setTaskView, setTabView, setDocumentScope,
    detailsOpen: factsRailOpen, setDetailsOpen: setFactsRailOpen,
  } = useMatterTabs()

  const [matter, setMatter] = useState(initialMatter)
  const [contacts, setContacts] = useState(initialContacts)
  const {
    liveIntakeId, setLiveIntakeId, intakeCompleted, setIntakeCompleted,
    sheetOpen: intakeSheetOpen, setSheetOpen: setIntakeSheetOpen,
    importOpen: importIntakeOpen, setImportOpen: setImportIntakeOpen,
    uploadCounts: unreviewedUploadCounts, markPortalReviewed: handleMarkPortalUploadsReviewed, openSheet: openIntakeSheet,
  } = useMatterIntake({
    matterId,
    initialIntakeId,
    initiallyCompleted: Boolean(clientIntakeRow?.intake_completed_at || initialMatter.intake_status === 'completed'),
    initialUploadCounts: initialUnreviewedUploadCounts,
  })
  const [matterNum, setMatterNum] = useState<string | null>(initialMatterNumber)
  const [matterType, setMatterType] = useState<MatterType | null>(initialMatterType)
  const [matterTypeSaving, setMatterTypeSaving] = useState(false)
  const [assetsTabVisited, setAssetsTabVisited] = useState(false)
  const [billingTabVisited, setBillingTabVisited] = useState(false)
  const [datesRequest, setDatesRequest] = useState(0)
  const [stageHistoryOpen, setStageHistoryOpen] = useState(false)
  const [schedulingLinkOpen, setSchedulingLinkOpen] = useState(false)
  const [bookForClientOpen, setBookForClientOpen] = useState(false)
  // Header Email/Text open the same composer the lead page uses, AI drafting
  // included, rather than only switching to the communications tab.
  const [composerChannel, setComposerChannel] = useState<'email' | 'sms' | null>(null)

  const {
    portalDraft,
    setPortalDraft,
    items: communicationItems,
    sendOnChannel,
    loadFullMessage,
    unreadPortalCount,
    lastPortalMessage,
    readError: messagesError,
    retry: retryMessages,
    portalLoading,
    portalSending,
    smsLoading,
    smsRecipient,
    smsSending,
    emailTo,
    emailSubject,
    emailBody,
    emailSending,
    setSmsRecipient,
    setEmailTo,
    setEmailSubject,
    setEmailBody,
    sendEmail,
  } = useMatterCommunications({
    matterId: matter.matter_id,
    token,
    initialEmailTo: initialMatter.client_email || '',
    enabled: activeTab === 'communications',
  })

  const {
    activity,
    cursor: activityCursor,
    loadingOlder: loadingOlderActivity,
    loadOlder: loadOlderActivity,
    prepend: prependActivity,
  } = useMatterActivity(matterId, initialActivity, initialActivityCursor)

  const {
    details: matterDetails,
    saveField: saveMatterDetailField,
    setDetails: setMatterDetails,
    savingField,
    lastSavedAt,
    error: matterDetailsError,
  } = useMatterDetailsSave(matterId, initialMatterDetails)

  const handleSaveMatterDetailField = useCallback(
    async (
      field: keyof MatterDetailsRow,
      value: unknown,
      options?: { manual?: boolean },
    ) => {
      await saveMatterDetailField(field, value, options)
      if (field === 'signing_date' && (typeof value === 'string' || value === null)) {
        setMatter(current => ({ ...current, signing_date: value }))
      }
      if (field === 'practice_area' && typeof value === 'string') {
        setMatter(current => ({ ...current, practice_area: value }))
      }
      if (field === 'plan_type' && typeof value === 'string') {
        setMatter(current => ({ ...current, plan_type: value }))
      }
      if (field === 'matter_number') {
        setMatterNum(typeof value === 'string' && value.trim() ? value.trim() : null)
      }
    },
    [saveMatterDetailField],
  )

  const handleSaveMatterType = useCallback(async (next: MatterType) => {
    setMatterTypeSaving(true)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/matter-type`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ matterType: next }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? 'Could not save matter type')
      setMatterType(next)
      toast.success('Matter type saved', { id: 'matter-type-save', duration: 1200 })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save matter type')
      throw error
    } finally {
      setMatterTypeSaving(false)
    }
  }, [matterId, token])

  const practiceArea = normalizePracticeArea(matterDetails?.practice_area ?? matter.practice_area)
  const showProbate = practiceArea === 'Probate'
  // Probate and Trust Administration both keep the estate's (or trust's) books.
  const showFiduciaryLedger = practiceArea === 'Probate' || practiceArea === 'TA'

  useEffect(() => {
    if (activeTab === 'assets') setAssetsTabVisited(true)
    if (activeTab === 'billing') setBillingTabVisited(true)
  }, [activeTab])

  useEffect(() => {
    setMatter(initialMatter)
  }, [initialMatter])

  useEffect(() => {
    setContacts(initialContacts)
  }, [initialContacts])

  useEffect(() => {
    setMatterNum(initialMatterNumber)
  }, [initialMatterNumber])

  const {
    editingNoteId,
    editingNoteText,
    editingNoteType,
    noteMutatingId,
    noteSaving,
    noteText,
    noteType,
    notes,
    setEditingNoteText,
    setEditingNoteType,
    setNoteText,
    setNoteType,
    cancelEditingNote,
    handleAddNote,
    handleLogCall,
    handleDeleteNote,
    handleUpdateNote,
    startEditingNote,
  } = useMatterNotes({ initialNotes, matterId, onActivityLogged: prependActivity })

  const leadNotes = useLinkedMatterNotes({ initialLeadNotes, initialMatterLinkedNotes, notes, editingNoteText, cancelEditingNote })
  const linkedNotes = leadNotes.linkedNotes

  // The matter-note delete asks here rather than in useMatterNotes: a hook has
  // nowhere to render a dialog, which is how this one kept window.confirm.
  const confirmThenDeleteNote = async (noteId: string) => {
    const confirmed = await confirmDelete({
      title: 'Delete this note?',
      body: 'This cannot be undone.',
      confirmLabel: 'Delete note',
      destructive: true,
    })
    if (!confirmed) return
    await handleDeleteNote(noteId)
  }

  const {
    currentEngineStageTask,
    handleEngineStageTaskUpdated,
    refreshEngineStageTask,
  } = useMatterEngineStageTask(matterId, matter.stage)

  const taskCounts = useRecordTaskCounts(matterId, initialTaskCounts)

  const stageControl = useMatterStage({ matter, setMatter, token })
  const { stageSaving, handleStageChange, closingMatter, handleCloseMatter } = stageControl
  const actions = useMatterHeaderActions({ matter, setMatter, setMatterDetails, token, liveIntakeId, setIntakeCompleted })
  const { unlocking, handleUnlockIntake, sendingEngagement, handleSendEngagement, handleDraftEngagement } = actions

  // Portal uploads now live on the Documents tab behind its Unreviewed filter,
  // so reviewing them is a tab switch rather than a card on Overview.
  const handleReviewUploads = useCallback(() => {
    if (unreviewedUploadCounts.intake > 0) {
      void openIntakeSheet()
      return
    }
    if (unreviewedUploadCounts.portal > 0) {
      setActiveTab('documents', undefined, undefined, 'unreviewed')
    }
  }, [openIntakeSheet, setActiveTab, unreviewedUploadCounts.intake, unreviewedUploadCounts.portal])

  // Snoozing is a per-user work-graph override; the refreshed page picks the next item.
  const handleSnoozeWork = useCallback(async (workKey: string, until: string) => {
    try {
      const res = await fetch('/api/admin/work-items/override', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workKey, state: 'snoozed', snoozedUntil: until }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not snooze this work')
      toast.success(`Snoozed until ${new Date(until).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not snooze this work')
    }
  }, [router, token])

  const unlockRequestedAt = clientIntakeRow?.unlock_requested_at ?? null
  const showUnlockBanner = Boolean(intakeCompleted && unlockRequestedAt)
  const nextAction = useMemo(
    () =>
      computeMatterNextAction(
        matter,
        esignEnabled
          ? {
              signed: Boolean(matterDetails?.engagement_signed),
              sentAt: matterDetails?.engagement_sent_at ?? null,
              status: matterDetails?.engagement_status ?? null,
            }
          : undefined,
        reviewFlags,
      ),
    [matter, matterDetails, esignEnabled, reviewFlags],
  )
  // max(communications.created_at) — the rail's quiet chip is derived from the
  // same timeline the Communications tab shows, never a stored column.
  const lastContactAt = useMemo(
    () => communicationItems.reduce<string | null>(
      (latest, item) => (!latest || item.created_at > latest ? item.created_at : latest),
      lastPortalMessage?.created_at ?? null,
    ),
    [communicationItems, lastPortalMessage],
  )
  const draftingHref = `/admin/drafting/${matter.matter_id}`
  const readinessItems = useMemo(
    () =>
      buildMatterReadinessItems({
        reviewFlags,
        unreviewedUploadCounts,
        unreadPortalCount,
        milestones: [
          { key: 'intake', label: 'Intake complete', resolved: intakeCompleted },
          { key: 'design-sheet', label: 'Design sheet seeded', resolved: designSheetSeeded },
          ...(esignEnabled
            ? [{
                key: 'engagement',
                label: 'Engagement signed',
                resolved: Boolean(matterDetails?.engagement_signed),
              }]
            : []),
        ],
      }),
    [
      designSheetSeeded,
      esignEnabled,
      intakeCompleted,
      matterDetails?.engagement_signed,
      reviewFlags,
      unreadPortalCount,
      unreviewedUploadCounts,
    ],
  )

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      {messagesError && <p role="alert" className="px-4 text-sm text-destructive">{messagesError} <Button variant="link" onClick={() => void retryMessages()}>Retry messages</Button></p>}
      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as MatterTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <MatterWorkspaceHeader
          matter={matter}
          matterNumber={matterNum}
          planLabel={designPlanTypeLabel(designSheetPlanType ?? planMirror.planType) || null}
          matterTypeLabel={matterType ? matterTypeLabel(matterType) : null}
          intakeCompleted={intakeCompleted}
          intakeId={liveIntakeId}
          unlocking={unlocking}
          factsRailOpen={factsRailOpen}
          onToggleFactsRail={() => setFactsRailOpen(open => !open)}
          onEmail={() => setComposerChannel('email')}
          onOpenIntake={() => void openIntakeSheet()}
          onImportIntake={() => setImportIntakeOpen(true)}
          onUnlockIntake={() => void handleUnlockIntake()}
          onPushToLawmatics={() => void actions.pushToLawmatics()}
          pushingToLawmatics={actions.pushingToLawmatics}
          onPushToStatular={() => void actions.pushToStatular()}
          pushingToStatular={actions.pushingToStatular}
          onDelete={actions.deleteDialog.openDialog}
          stage={showProbate ? (
            <ProbateStageStrip details={matterDetails} />
          ) : (
            <MatterStageStrip
              stage={matter.stage}
              details={matterDetails}
              agingSummary={agingSummary}
              stageSaving={stageSaving}
              onStageChange={stage => void handleStageChange(stage)}
              history={initialStageHistory}
            />
          )}
          navigation={<MatterWorkspaceNav matterId={matterId} active={activeTab} counts={{ tasks: taskCounts.open, reviews: reviewBlockerCount, documents: unreviewedUploadCounts.total, communications: unreadPortalCount }} drafting={!showFiduciaryLedger} onSelect={section => {
            if (section === 'drafting') router.push(draftingHref)
            else setActiveTab(section)
          }} />}
        />

      {showUnlockBanner && (
        <div className="border-b border-amber-border bg-amber-bg px-4 py-3 text-sm text-amber-strong md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">Client requested intake changes</p>
              <p className="text-xs text-amber">
                {clientIntakeRow?.unlock_request_note?.trim()
                  || 'The client asked to update their submitted intake. Unlock to allow edits.'}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={unlocking} onClick={() => void handleUnlockIntake()}>
              {unlocking ? 'Unlocking…' : 'Unlock intake'}
            </Button>
          </div>
        </div>
      )}

        <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="flex-1 p-4 md:p-6">
            <div className="w-full gap-4">
              {taskCounts.error && (
                <p role="status" className="text-sm text-destructive">
                  {taskCounts.error}{' '}
                  <button type="button" className="underline" onClick={() => void taskCounts.refresh()}>Retry</button>
                </p>
              )}

              <TabsContent value="overview">
                <MatterOverviewWork
                  matter={matter} nextAction={nextAction} workSummary={workSummary}
                  engagement={esignEnabled ? { signed: Boolean(matterDetails?.engagement_signed), sentAt: matterDetails?.engagement_sent_at ?? null, status: matterDetails?.engagement_status ?? null } : undefined}
                  reviewFlags={reviewFlags} unreadCount={unreadPortalCount} uploadCount={unreviewedUploadCounts.total}
                  details={matterDetails} onDates={() => { setDatesRequest(value => value + 1); setFactsRailOpen(true) }} activity={activity}
                  onEngagement={() => void handleSendEngagement()} onUploads={handleReviewUploads}
                  onMessages={() => setActiveTab('communications', undefined, 'portal')}
                  onActivity={() => setActiveTab('activity')}
                  onSnooze={handleSnoozeWork}
                  composer={<MatterOverviewComposer
                    matterId={matterId} clientName={matter.client_name ?? 'Client'} clientEmail={matter.client_email ?? null}
                    clientPhone={matter.client_phone ?? null} smsEnabled={smsEnabled} emailEnabled={emailSendEnabled}
                    noteText={noteText} onNoteChange={setNoteText} noteSaving={noteSaving} onAddNote={() => handleAddNote('Internal')}
                    portalDraft={portalDraft} onPortalChange={setPortalDraft} onSend={sendOnChannel}
                    smsRecipient={smsRecipient} onSmsRecipientChange={setSmsRecipient}
                    onLogCall={handleLogCall} onEmailSent={() => { void retryMessages(); router.refresh() }}
                  />}
                  sidebar={<MatterOverviewSidebar
                    matter={matter} details={matterDetails} plan={planMirror} estate={initialEstateSnapshot}
                    onPeople={() => setActiveTab('people')} onBilling={() => setActiveTab('billing')}
                    tasks={<><div className="mb-2 flex items-center justify-between"><span>Tasks · {taskCounts.open} open</span><Button variant="link" className="h-auto p-0" onClick={() => setActiveTab('tasks')}>View all</Button></div>{taskPreview.some(task => task.key !== workSummary?.workKey) ? <ul>{taskPreview.filter(task => task.key !== workSummary?.workKey).map(task => <li key={task.key}><Link className="block py-1 underline-offset-4 hover:underline" href={task.href}>{task.title}</Link></li>)}</ul> : currentEngineStageTask && workSummary?.workKey !== `task:${currentEngineStageTask.id}` ? <MatterEngineStageTaskCard compact task={currentEngineStageTask} onUpdated={handleEngineStageTaskUpdated} /> : <p className="text-xs text-muted-foreground">{taskCounts.open ? 'View all tasks for the full list.' : 'No open tasks.'}</p>}</>}
                  >
                    {showProbate && (
                      <MatterProbateEssentialsCard
                        details={matterDetails}
                        onSaveField={handleSaveMatterDetailField}
                        savingField={savingField}
                        lastSavedAt={lastSavedAt}
                        error={matterDetailsError}
                      />
                    )}
                    {showFiduciaryLedger && <EstateLedgerCard matterId={matterId} trust={practiceArea === 'TA'} />}
                  </MatterOverviewSidebar>}
                />
              </TabsContent>

              <TabsContent value="tasks" className="space-y-4">
                {currentEngineStageTask && <MatterEngineStageTaskCard task={currentEngineStageTask} onUpdated={handleEngineStageTaskUpdated} />}
                <RecordTabHeader
                  title="Tasks"
                  description="Firm work on this matter, by due date or by stage."
                  actions={
                    <ViewSwitch value={taskView} options={TASK_VIEW_OPTIONS} onChange={setTaskView} label="Task view" />
                  }
                />
                <RecordTasksTab
                  recordId={matterId}
                  recordKind="matter"
                  recordName={matter.client_name ?? null}
                  defaultPresentation="board"
                  onStageTaskCompleted={() => void refreshEngineStageTask()}
                  onTasksChanged={() => void taskCounts.refresh()}
                  view={taskView}
                  onViewChange={setTaskView}
                  hideViewSwitch
                />
              </TabsContent>

              <MatterPeopleTab
                matterId={matterId}
                matter={matter}
                initialContacts={contacts}
                planMirror={planMirror}
              />

              <MatterAssetsTabContent
                matterId={matterId}
                matter={matter}
                intakeId={liveIntakeId}
                enabled={assetsTabVisited}
                anticipatedInheritance={Boolean(matterDetails?.ep_anticipated_inheritance)}
                onAnticipatedInheritanceChange={next =>
                  void handleSaveMatterDetailField('ep_anticipated_inheritance', next)}
                view={assetView}
                onViewChange={view => setTabView('assets', view, 'inventory')}
              />

              <TabsContent value="documents" className="space-y-4">
                <MatterDocumentsWorkspace
                  matter={matter}
                  enabled={activeTab === 'documents'}
                  view={documentView}
                  onViewChange={view => setTabView('documents', view, 'files')}
                  scope={documentScope}
                  onScopeChange={setDocumentScope}
                  deepLinkedDocumentId={deepLinkedDocumentId}
                  probate={showProbate}
                  unreviewedUploadCounts={unreviewedUploadCounts}
                  onReviewPortalUploads={handleMarkPortalUploadsReviewed}
                  onReviewIntakeUploads={openIntakeSheet}
                  esignDocumentsEnabled={esignDocumentsEnabled}
                />
              </TabsContent>

              <MatterBillingTab
                matterId={matterId}
                enabled={billingTabVisited}
                details={matterDetails}
                onSaveField={handleSaveMatterDetailField}
                onCloseMatter={handleCloseMatter}
                closing={closingMatter}
                alreadyClosed={matter.stage === 'closed'}
              />

              <MatterCommunicationsTab
                matterId={matter.matter_id}
                channel={communicationChannel}
                onChannelChange={channel => setActiveTab('communications', undefined, channel)}
                portalDraft={portalDraft}
                setPortalDraft={setPortalDraft}
                items={communicationItems}
                clientName={matter.client_name || matter.matter_name || 'Client'}
                clientPhone={matter.client_phone || null}
                recordLabel={matterNum ?? (matter.client_name || matter.matter_name || 'this matter')}
                onSendOnChannel={sendOnChannel}
                loadFullMessage={loadFullMessage}
                portalLoading={portalLoading}
                portalSending={portalSending}
                smsLoading={smsLoading}
                smsRecipient={smsRecipient}
                smsSending={smsSending}
                emailTo={emailTo}
                emailSubject={emailSubject}
                emailBody={emailBody}
                emailSending={emailSending}
                smsEnabled={smsEnabled}
                emailSendEnabled={emailSendEnabled}
                setSmsRecipient={setSmsRecipient}
                setEmailTo={setEmailTo}
                setEmailSubject={setEmailSubject}
                setEmailBody={setEmailBody}
                onSendEmail={() => void sendEmail()}
                onSendSchedulingLink={() => setSchedulingLinkOpen(true)}
                onBookForClient={() => setBookForClientOpen(true)}
              />

              <MatterNotesTab
                editingNoteId={editingNoteId}
                editingNoteText={editingNoteText}
                editingNoteType={editingNoteType}
                noteMutatingId={noteMutatingId}
                noteSaving={noteSaving}
                noteText={noteText}
                noteType={noteType}
                notes={linkedNotes}
                setEditingNoteText={setEditingNoteText}
                setEditingNoteType={setEditingNoteType}
                setNoteText={setNoteText}
                setNoteType={setNoteType}
                cancelEditingNote={cancelEditingNote}
                handleAddNote={handleAddNote}
                handleDeleteNote={confirmThenDeleteNote}
                handleUpdateNote={handleUpdateNote}
                handleDeleteLeadNote={leadNotes.requestDeleteLeadNote}
                handleUpdateLeadNote={leadNotes.updateLeadNote}
                startEditingNote={startEditingNote}
                meetingNotes={<MatterMeetingNotesCard matterId={matterId} defaultOpen />}
              />

              <TabsContent value="reviews" className="space-y-4">
                <RecordTabHeader
                  title="Reviews"
                  description="Playbook reviews of this matter's documents and field audits of its design sheet."
                />
                {activeTab === 'reviews' ? <MatterReviewsTab matterId={matterId} /> : null}
              </TabsContent>

              <TabsContent value="activity" className="space-y-4">
                <RecordTabHeader
                  title="Activity"
                  description="Stage changes, intake, communications, and drafting events, newest first."
                />
                <MatterStageHistoryCard entries={initialStageHistory} open={stageHistoryOpen} onOpenChange={setStageHistoryOpen} />
                <MatterActivityTab
                  activity={activity}
                  loading={false}
                  olderCursor={activityCursor}
                  loadingOlder={loadingOlderActivity}
                  onLoadOlder={() => void loadOlderActivity()}
                />
              </TabsContent>
            </div>
          </div>
        </div>

        <ResponsiveDetailRail
          open={factsRailOpen}
          onOpenChange={open => {
            if (!open && savingField) return
            setFactsRailOpen(open)
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
              datesRequest,
              keyDates: <MatterKeyDates matterId={matterId} details={{ ...matterDetails, signing_date: matterDetails?.signing_date ?? matter.signing_date }} onSaveField={handleSaveMatterDetailField} />,
              matter,
              matterId,
              matterType,
              matterTypeSaving,
              details: matterDetails,
              designSheetPlanType,
              planMirror,
              lastContactAt,
              estate: initialEstateSnapshot,
              readinessItems,
              activity,
              noteText,
              onNoteTextChange: setNoteText,
              onAddNote: () => void handleAddNote(),
              noteSaving,
              noteCount: linkedNotes.length,
              latestNoteAt: linkedNotes[0]?.created_at ?? null,
              onSaveField: handleSaveMatterDetailField,
              onSaveMatterType: handleSaveMatterType,
              savingField,
              lastSavedAt,
              error: matterDetailsError,
              onOpenTab: tab => { setFactsRailOpen(false); setActiveTab(tab) },
            }}
            admin={{
              matter,
              matterId,
              matterNumber: matterNum,
              matterNumberManual,
              matterStatus: matter.status ?? 'active',
              onStatusChange: status => void actions.handleStatusChange(status),
              statusSaving: actions.statusSaving,
              details: matterDetails,
              designSheetPlanType,
              onSaveField: handleSaveMatterDetailField,
              savingField,
              lastSavedAt,
              error: matterDetailsError,
              esignEnabled,
              engagementSending: sendingEngagement,
              onSendEngagement: () => void handleSendEngagement(),
              onDraftEngagement: () => void handleDraftEngagement(),
            }}
            onOpenIntake={() => void openIntakeSheet()}
          />
        </ResponsiveDetailRail>
        </div>
      </Tabs>

      <MatterDialogs
        matter={matter}
        token={token}
        intake={{
          importOpen: importIntakeOpen,
          setImportOpen: setImportIntakeOpen,
          sheetOpen: intakeSheetOpen,
          setSheetOpen: setIntakeSheetOpen,
          liveIntakeId,
          setLiveIntakeId,
          setIntakeCompleted,
          clientUserId: clientIntakeRow?.client_user_id ?? clientIntakeRow?.user_id ?? null,
          practiceArea: practiceAreaLabel(matterDetails?.practice_area ?? matter.practice_area),
        }}
        deleteDialog={actions.deleteDialog}
        unlock={{ open: actions.unlockConfirmOpen, setOpen: actions.setUnlockConfirmOpen, confirm: actions.confirmUnlockIntake }}
        stage={{
          preflight: stageControl.stagePreflight,
          setPreflight: stageControl.setStagePreflight,
          saving: stageSaving,
          confirm: preflight => void handleStageChange(preflight.stage, {
            version: preflight.version,
            blockerKeys: preflight.blockers.map(blocker => blocker.key),
          }),
        }}
        leadNoteDelete={{ target: leadNotes.deleteTarget, setTarget: leadNotes.setDeleteTarget, confirm: leadNotes.deleteLeadNote }}
        scheduling={{ linkOpen: schedulingLinkOpen, setLinkOpen: setSchedulingLinkOpen, bookOpen: bookForClientOpen, setBookOpen: setBookForClientOpen }}
        composer={{ channel: composerChannel, setChannel: setComposerChannel }}
      />
      {confirmDialog}
    </div>
  )
}
