'use client'
import Link from 'next/link'
import { usePrimaryReady } from '@/app/admin/components/NavigationTiming'

import { listenForMatterContacts } from '@/lib/matters/contactEvents'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FileText, Signature } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { useConfirm } from '@/components/useConfirm'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import {
  matterStatusLabel,
  stageLabel,
  type MatterActivity,
  type MatterContact,
  type MatterStage,
  type MatterStatus,
  type PipelineMatter,
} from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterType } from '@/lib/matter/matterType'
import { EMPTY_PLAN_MIRROR, type MatterPlanMirror } from '@/lib/matter/planMirror'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import {
  type AssetView,
  type CommunicationChannel,
  type DocumentView,
  type MatterTab,
  parseAssetView,
  parseCommunicationChannel,
  parseDocumentView,
  parseMatterTab,
  parseTaskView,
  type TaskView,
} from '@/lib/matterPageTabs'
import { ViewSwitch, type ViewSwitchOption } from '@/components/ViewSwitch'
import { MatterSigningPanel } from './tabs/signing/MatterSigningPanel'
import {
  mergeUnreviewedCounts,
  type UnreviewedUploadCounts,
} from '@/lib/matter/unreviewedUploads'
import {
  resolveMatterIntake,
  unlockIntake,
  markIntakeUploadsReviewed,
  markPortalUploadsReviewed,
} from '@/app/actions/adminIntake'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { RecordTasksTab, TASK_VIEW_OPTIONS } from '@/components/tasks/RecordTasksTab'
import { useRecordTaskCounts } from '@/components/tasks/useRecordTaskCounts'
import type { RecordTaskCounts } from '@/lib/tasks/types'
import { MatterDetailsCard } from './MatterDetailsCard'
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
import { MatterDocumentsTab } from './MatterDocumentsTab'
import { RequestedDocumentsCard } from './RequestedDocumentsCard'
import { useMatterNotes } from './useMatterNotes'
import { useMatterEngineStageTask } from './useMatterEngineStageTask'
import { MatterNotesTab, linkLiveMatterNotes, mergeLinkedNotes, type LinkedMatterNote } from './tabs/notes'
import { MatterCommunicationsTab } from './tabs/messages'
import { MatterBillingTab } from './tabs/billing'
import { SendSchedulingLinkDialog } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BookCalendlyDialog } from '@/components/scheduling/BookCalendlyDialog'
import { MatterEngineStageTaskCard } from '@/components/admin/MatterEngineStageTaskCard'
import { MatterOverviewFacts } from './MatterOverviewFacts'
import { MatterKeyDates } from './MatterKeyDates'
import { MatterOverviewComposer } from './MatterOverviewComposer'
import { MatterOverviewWork } from './MatterOverviewWork'
import { MatterDetailHeader } from './MatterDetailHeader'
import { usePushToLawmatics } from '@/hooks/usePushToLawmatics'
import { usePushToStatular } from '@/hooks/usePushToStatular'
import { MatterFactsPanel } from './facts-panel/MatterFactsPanel'
import {
  ResponsiveDetailRail,
} from '@/components/layout/ResponsiveDetailRail'
import { MatterStageStrip } from './MatterStageStrip'
import { ProbateStageStrip } from './ProbateStageStrip'
import { EstateLedgerCard } from './EstateLedgerCard'
import { buildMatterReadinessItems } from './MatterReadinessDial'
import { CommunicationDialog } from '@/components/comms/CommunicationDialog'
import { useMatterCommunications } from './useMatterCommunications'
import { useMatterDocuments } from './useMatterDocuments'
import { MatterWorkspaceNav } from '@/components/matter/MatterWorkspaceNav'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('./ImportIntakeDialog'), { ssr: false })

const DOCUMENT_VIEW_OPTIONS: readonly ViewSwitchOption<DocumentView>[] = [
  { value: 'files', label: 'Files', icon: FileText },
  { value: 'signing', label: 'Signing', icon: Signature },
]

type StageLifecyclePreflight = {
  stage: MatterStage
  version: string
  blockers: Array<{
    key: string
    label: string
    owner: string
    resolution: string
  }>
}

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
  initialLeadNotes?: Array<{ id: string; lead_id: string; body: string; created_at: string; note_type: 'internal' | 'system' }>
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
  workSummary = null,
  taskPreview = [],
}: MatterDetailClientProps) {
  usePrimaryReady('Matter detail', matterId)
  const token = useAccessToken()
  const { confirm: confirmDelete, confirmDialog } = useConfirm()
  const router = useRouter()
  useEffect(() => listenForMatterContacts(matterId, () => router.refresh()), [matterId, router])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = parseMatterTab(searchParams.get('tab'))
  const communicationChannel = parseCommunicationChannel(searchParams.get('channel'))
  // The Tasks tab's two faces. `?tab=sla` from an older link resolves to
  // `tasks`, so plan links keep working; `?view=plan` opens the plan directly.
  const taskView = parseTaskView(searchParams.get('view'))
  // Assets' inventory or funding, Documents' files or signing — `?view=` on
  // those tabs, the same parameter the Tasks tab uses.
  const assetView = parseAssetView(activeTab === 'assets' ? searchParams.get('view') : null)
  const documentView = parseDocumentView(activeTab === 'documents' ? searchParams.get('view') : null)

  const [matter, setMatter] = useState(initialMatter)
  const [contacts, setContacts] = useState(initialContacts)
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialIntakeId)
  const [intakeCompleted, setIntakeCompleted] = useState(
    Boolean(clientIntakeRow?.intake_completed_at || matter.intake_status === 'completed'),
  )
  const [intakeSheetOpen, setIntakeSheetOpen] = useState(false)
  const [importIntakeOpen, setImportIntakeOpen] = useState(false)
  const [stageSaving, setStageSaving] = useState(false)
  const [stagePreflight, setStagePreflight] = useState<StageLifecyclePreflight | null>(null)
  const [statusSaving, setStatusSaving] = useState(false)
  const { documents, folders: documentFolders, signatureRequests, loading: docsLoading, documentsError, foldersError, reload: loadDocuments } = useMatterDocuments(matter.matter_id, activeTab === 'documents')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Set when the server refuses a first-click delete because the matter is
  // hired or carries a signed engagement. Holds its reasons so the dialog can
  // name what is about to be destroyed instead of repeating a generic warning.
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [matterNum, setMatterNum] = useState<string | null>(initialMatterNumber)
  const [matterType, setMatterType] = useState<MatterType | null>(initialMatterType)
  const [matterTypeSaving, setMatterTypeSaving] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [unreviewedUploadCounts, setUnreviewedUploadCounts] = useState(initialUnreviewedUploadCounts)
  const [assetsTabVisited, setAssetsTabVisited] = useState(false)
  const [billingTabVisited, setBillingTabVisited] = useState(false)
  const [factsRailOpen, setFactsRailOpen] = useState(false)
  const [datesRequest, setDatesRequest] = useState(0)
  const [stageHistoryOpen, setStageHistoryOpen] = useState(false)


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

  const [activity, setActivity] = useState<MatterActivity[]>(initialActivity)
  const activityLoading = false
  const [activityCursor, setActivityCursor] = useState<string | null>(initialActivityCursor)
  const [loadingOlderActivity, setLoadingOlderActivity] = useState(false)
  const loadOlderActivity = useCallback(async () => {
    if (!activityCursor) return
    setLoadingOlderActivity(true)
    try {
      const response = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/activity?before=${encodeURIComponent(activityCursor)}`)
      const body = (await response.json().catch(() => ({}))) as { activity?: MatterActivity[]; cursor?: string | null; error?: string }
      if (!response.ok || !body.activity) throw new Error(body.error ?? 'Could not load older activity')
      const older = body.activity
      setActivity(current => {
        const seen = new Set(current.map(item => item.id))
        return [...current, ...older.filter(item => !seen.has(item.id))]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      })
      setActivityCursor(body.cursor ?? null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load older activity')
    } finally {
      setLoadingOlderActivity(false)
    }
  }, [activityCursor, matterId])
  // Header Email/Text open the same composer the lead page uses, AI drafting
  // included, rather than only switching to the communications tab.
  const [composerChannel, setComposerChannel] = useState<'email' | 'sms' | null>(null)

  useEffect(() => {
    setUnreviewedUploadCounts(initialUnreviewedUploadCounts)
  }, [initialUnreviewedUploadCounts])

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

  const setActiveTab = useCallback((
    tab: MatterTab,
    section?: string,
    channel?: CommunicationChannel,
    documentScope?: 'unreviewed',
  ) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'overview') {
      params.delete('tab')
      params.delete('channel')
    } else {
      params.set('tab', tab)
      if (tab === 'communications') {
        params.set('channel', channel ?? communicationChannel)
      } else {
        params.delete('channel')
      }
      if (tab !== 'tasks') params.delete('view')
    }
    if (tab !== 'documents') { params.delete('scope'); params.delete('document') }
    else if (documentScope) { params.set('scope', documentScope); params.delete('document') }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    if (section) {
      requestAnimationFrame(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [communicationChannel, pathname, router, searchParams])

  const setTaskView = useCallback((view: TaskView) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'tasks')
    if (view === 'queue') params.delete('view')
    else params.set('view', view)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  /** Switches the face of the current tab; the default face drops `?view=`. */
  const setTabView = useCallback((tab: 'assets' | 'documents', view: AssetView | DocumentView, defaultView: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    if (view === defaultView) params.delete('view')
    else params.set('view', view)
    if (tab === 'documents') { params.delete('scope'); params.delete('document') }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

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

  useEffect(() => {
    setLiveIntakeId(initialIntakeId)
  }, [initialIntakeId])

  const prependActivity = useCallback((row: MatterActivity) => {
    setActivity(current => {
      if (current.some(item => item.id === row.id)) return current
      return [row, ...current]
    })
  }, [])

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

  const [leadNotes, setLeadNotes] = useState(initialLeadNotes)
  const linkedNotes = useMemo(() => mergeLinkedNotes(
    leadNotes.map(note => ({ id: note.id, sourceId: note.id, origin: 'lead' as const, leadId: note.lead_id, body: note.body, created_at: note.created_at, note_type: note.note_type })),
    linkLiveMatterNotes(notes, initialMatterLinkedNotes),
  ), [initialMatterLinkedNotes, leadNotes, notes])

  const handleUpdateLeadNote = async (note: LinkedMatterNote) => {
    if (!note.leadId) return
    const body = editingNoteText.trim()
    const response = await fetch(`/api/admin/leads/${note.leadId}/notes/${note.sourceId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    })
    if (!response.ok) {
      toast.error('Could not update lead note')
      return
    }
    setLeadNotes(current => current.map(item => item.id === note.sourceId ? { ...item, body } : item))
    cancelEditingNote()
    toast.success('Lead note updated')
  }

  const [deleteNoteTarget, setDeleteNoteTarget] = useState<LinkedMatterNote | null>(null)
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false)
  const [schedulingLinkOpen, setSchedulingLinkOpen] = useState(false)
  const [bookForClientOpen, setBookForClientOpen] = useState(false)

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

  const handleDeleteLeadNote = async (note: LinkedMatterNote) => {
    if (!note.leadId) return
    setDeleteNoteTarget(note)
  }

  const confirmDeleteLeadNote = async (note: LinkedMatterNote) => {
    if (!note.leadId) return
    const response = await fetch(`/api/admin/leads/${note.leadId}/notes/${note.sourceId}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error('Could not delete lead note')
      return
    }
    setLeadNotes(current => current.filter(item => item.id !== note.sourceId))
    toast.success('Lead note deleted')
  }

  const {
    currentEngineStageTask,
    handleEngineStageTaskUpdated,
    refreshEngineStageTask,
  } = useMatterEngineStageTask(matterId, matter.stage)

  const taskCounts = useRecordTaskCounts(matterId, initialTaskCounts)

  const { push: pushToLawmatics, pushing: pushingToLawmatics } = usePushToLawmatics(liveIntakeId)
  const { push: pushToStatular, pushing: pushingToStatular } = usePushToStatular(liveIntakeId)

  const handleUnlockIntake = useCallback(() => {
    if (!liveIntakeId || unlocking) return
    setUnlockConfirmOpen(true)
  }, [liveIntakeId, unlocking])

  const confirmUnlockIntake = useCallback(async () => {
    if (!liveIntakeId || unlocking) return
    setUnlockConfirmOpen(false)
    setUnlocking(true)
    try {
      await unlockIntake({ intakeId: liveIntakeId, matterId })
      setIntakeCompleted(false)
      toast.success('Intake unlocked for client editing')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not unlock intake')
    } finally {
      setUnlocking(false)
    }
  }, [liveIntakeId, matterId, router, unlocking])

  const handleMarkIntakeUploadsReviewed = useCallback(async (intakeId: string) => {
    try {
      await markIntakeUploadsReviewed({ intakeId, matterId })
      setUnreviewedUploadCounts(prev => mergeUnreviewedCounts(0, prev.portal))
    } catch {
      /* non-blocking */
    }
  }, [matterId])

  const handleMarkPortalUploadsReviewed = useCallback(async () => {
    try {
      await markPortalUploadsReviewed({ matterId })
      setUnreviewedUploadCounts(prev => mergeUnreviewedCounts(prev.intake, 0))
    } catch {
      /* non-blocking */
    }
  }, [matterId])

  const openIntakeSheet = useCallback(async () => {
    const openSheet = async (intakeId: string | null) => {
      if (intakeId) {
        await handleMarkIntakeUploadsReviewed(intakeId)
      }
      setIntakeSheetOpen(true)
    }

    if (liveIntakeId) {
      await openSheet(liveIntakeId)
      return
    }
    try {
      const resolved = await resolveMatterIntake(matterId)
      if (resolved) {
        setLiveIntakeId(resolved)
        await openSheet(resolved)
      } else {
        await openSheet(null)
      }
    } catch {
      await openSheet(null)
    }
  }, [handleMarkIntakeUploadsReviewed, liveIntakeId, matterId])

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

  const handleStatusChange = async (status: MatterStatus) => {
    if (!token || status === (matter.status ?? 'active')) return
    setStatusSaving(true)
    const previous = matter.status
    setMatter(m => ({ ...m, status }))
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not update status')
      toast.success(`Matter ${matterStatusLabel(status).toLowerCase()}`)
      router.refresh()
    } catch (e) {
      setMatter(m => ({ ...m, status: previous }))
      toast.error(e instanceof Error ? e.message : 'Could not update status')
    } finally {
      setStatusSaving(false)
    }
  }

  const handleStageChange = useCallback(async (
    stage: MatterStage,
    confirmation?: { version: string; blockerKeys: string[] },
  ): Promise<boolean> => {
    if (!token || stage === matter.stage) return false
    setStageSaving(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stage,
          confirmBlockers: Boolean(confirmation),
          lifecycleVersion: confirmation?.version,
          confirmedBlockerKeys: confirmation?.blockerKeys,
        }),
      })
      const body = await res.json().catch(() => ({})) as {
        error?: string
        requiresConfirmation?: boolean
        lifecycle?: {
          version?: string
          targetStage?: MatterStage
          blockers?: StageLifecyclePreflight['blockers']
        }
      }
      if (res.status === 409 && body.requiresConfirmation && body.lifecycle?.version) {
        setStagePreflight({
          stage: body.lifecycle.targetStage ?? stage,
          version: body.lifecycle.version,
          blockers: body.lifecycle.blockers ?? [],
        })
        return false
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not update stage')
      const blockers = body.lifecycle?.blockers ?? []
      setMatter(current => ({ ...current, stage }))
      setStagePreflight(null)
      if (blockers.length) {
        toast.warning(`Stage updated after confirming ${blockers.length} lifecycle blocker${blockers.length === 1 ? '' : 's'}`)
      } else {
        toast.success(`Stage updated to ${stageLabel(stage)}`)
      }
      router.refresh()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update stage')
      return false
    } finally {
      setStageSaving(false)
    }
  }, [matter.matter_id, matter.stage, router, token])

  const [closingMatter, setClosingMatter] = useState(false)
  /**
   * Close-out is one server action: the stage route runs the billing check,
   * moves both axes, stamps the closed and retention dates, and offers the
   * client a closing notice (lib/fileClosing). Nothing is saved from here.
   */
  const handleCloseMatter = useCallback(async () => {
    if (closingMatter) return
    setClosingMatter(true)
    try {
      await handleStageChange('closed')
    } finally {
      setClosingMatter(false)
    }
  }, [closingMatter, handleStageChange])

  const [sendingEngagement, setSendingEngagement] = useState(false)
  const handleSendEngagement = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSendingEngagement(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/engagement`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not send engagement')
      if (body.row) {
        setMatterDetails(prev => ({ ...(prev ?? {}), ...(body.row as MatterDetailsRow) }))
      }
      toast.success(`Engagement sent to ${matter.client_email ?? 'the client'}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send engagement')
    } finally {
      setSendingEngagement(false)
    }
  }

  const handleDraftEngagement = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSendingEngagement(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/engagement-draft`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not open engagement draft')
      router.push(`/admin/engagements/${body.agreementId}?step=design`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open engagement draft')
    } finally {
      setSendingEngagement(false)
    }
  }

  const handleDeleteMatter = async (confirm = false) => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        requiresConfirmation?: boolean
      }
      // Not a failure — the matter is protected and the dialog escalates to a
      // typed confirmation rather than sending the attorney back to the menu.
      if (!res.ok && body.requiresConfirmation) {
        setDeleteWarning(body.error ?? 'This matter holds client records.')
        setDeleteConfirmText('')
        return
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not delete matter')
      toast.success('Matter deleted')
      setDeleteOpen(false)
      router.push('/admin/matters')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete matter')
    } finally {
      setDeleting(false)
    }
  }

  const closeDeleteDialog = () => {
    setDeleteOpen(false)
    setDeleteWarning(null)
    setDeleteConfirmText('')
  }

  const unlockRequestedAt = clientIntakeRow?.unlock_requested_at ?? null
  const showUnlockBanner = Boolean(intakeCompleted && unlockRequestedAt)
  const matterLabel = matter.client_name || matter.matter_name || 'this matter'
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
      <MatterDetailHeader
        matter={matter}
        matterNumber={matterNum}
        intakeCompleted={intakeCompleted}
        intakeId={liveIntakeId}
        unlocking={unlocking}
        factsRailOpen={factsRailOpen}
        onToggleFactsRail={() => setFactsRailOpen(open => !open)}
        onEmail={() => setComposerChannel('email')}
        onOpenIntake={() => void openIntakeSheet()}
        onImportIntake={() => setImportIntakeOpen(true)}
        onUnlockIntake={() => void handleUnlockIntake()}
        onPushToLawmatics={() => void pushToLawmatics()}
        pushingToLawmatics={pushingToLawmatics}
        onPushToStatular={() => void pushToStatular()}
        pushingToStatular={pushingToStatular}
        onDelete={() => setDeleteOpen(true)}
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
        <ResponsiveDetailRail
          drawer
          open={factsRailOpen}
          onOpenChange={open => {
            if (!open && savingField) return
            setFactsRailOpen(open)
          }}
          label="Matter details"
          desktopClassName="w-72 xl:w-80 border-r border-border bg-card"
          mobileClassName="bg-card"
        >
          <div className="h-full overflow-y-auto pt-8">
          <MatterFactsPanel
            datesRequest={datesRequest}
            keyDates={<MatterKeyDates matterId={matterId} details={{ ...matterDetails, signing_date: matterDetails?.signing_date ?? matter.signing_date }} onSaveField={handleSaveMatterDetailField} />}
            simplified
            matter={matter}
            matterId={matterId}
            matterType={matterType}
            matterTypeSaving={matterTypeSaving}
            details={matterDetails}
            designSheetPlanType={designSheetPlanType}
            planMirror={planMirror}
            lastContactAt={lastContactAt}
            estate={initialEstateSnapshot}
            readinessItems={readinessItems}
            activity={activity}
            noteText={noteText}
            onNoteTextChange={setNoteText}
            onAddNote={() => void handleAddNote()}
            noteSaving={noteSaving}
            noteCount={linkedNotes.length}
            latestNoteAt={linkedNotes[0]?.created_at ?? null}
            onSaveField={handleSaveMatterDetailField}
            onSaveMatterType={handleSaveMatterType}
            savingField={savingField}
            lastSavedAt={lastSavedAt}
            error={matterDetailsError}
            onOpenTab={tab => { setFactsRailOpen(false); setActiveTab(tab) }}
          />
<details className="border-t p-4"><summary className="cursor-pointer text-sm font-medium">Administrative settings</summary>
                <MatterDetailsCard
                  matter={matter}
                  matterId={matterId}
                  matterNumber={matterNum}
                  matterNumberManual={matterNumberManual}
                  matterStatus={matter.status ?? 'active'}
                  onStatusChange={status => void handleStatusChange(status)}
                  statusSaving={statusSaving}
                  details={matterDetails}
                  designSheetPlanType={designSheetPlanType}
                  onSaveField={handleSaveMatterDetailField}
                  savingField={savingField}
                  lastSavedAt={lastSavedAt}
                  error={matterDetailsError}
                  esignEnabled={esignEnabled}
                  engagementSending={sendingEngagement}
                  onSendEngagement={() => void handleSendEngagement()}
                  onDraftEngagement={() => void handleDraftEngagement()}
                />
<Button variant="outline" onClick={() => void openIntakeSheet()}>Review / update intake</Button>
</details></div>
        </ResponsiveDetailRail>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <div className="border-b border-border bg-card px-4 py-2">
            {showProbate ? (
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
          </div>



          <div className="flex-1 px-4 py-4">
            <Tabs
              value={activeTab}
              onValueChange={v => setActiveTab(v as MatterTab)}
              className="w-full gap-4"
            >
              {taskCounts.error && (
                <p role="status" className="text-sm text-destructive">
                  {taskCounts.error}{' '}
                  <button type="button" className="underline" onClick={() => void taskCounts.refresh()}>Retry</button>
                </p>
              )}
              <MatterWorkspaceNav matterId={matterId} active={activeTab} counts={{ tasks: taskCounts.open, documents: unreviewedUploadCounts.total, communications: unreadPortalCount }} drafting={!showFiduciaryLedger} onSelect={section => {
                if (section === 'drafting') router.push(draftingHref)
                else setActiveTab(section)
              }} />

              <TabsContent value="overview">
                <MatterOverviewWork
                  matter={matter} nextAction={nextAction} workSummary={workSummary}
                  engagement={esignEnabled ? { signed: Boolean(matterDetails?.engagement_signed), sentAt: matterDetails?.engagement_sent_at ?? null, status: matterDetails?.engagement_status ?? null } : undefined}
                  reviewFlags={reviewFlags} unreadCount={unreadPortalCount} uploadCount={unreviewedUploadCounts.total}
                  details={matterDetails} onDates={() => { setDatesRequest(value => value + 1); setFactsRailOpen(true) }} activity={activity}
                  onEngagement={() => void handleSendEngagement()} onUploads={handleReviewUploads}
                  onMessages={() => setActiveTab('communications', undefined, 'portal')}
                  onActivity={() => setActiveTab('activity')}
                  facts={<MatterOverviewFacts matter={matter} details={matterDetails} plan={planMirror} estate={initialEstateSnapshot} lastContactAt={lastContactAt} onDetails={() => setFactsRailOpen(true)} />}
                  composer={<MatterOverviewComposer
                    matterId={matterId} clientName={matter.client_name ?? 'Client'} clientEmail={matter.client_email ?? null}
                    clientPhone={matter.client_phone ?? null} smsEnabled={smsEnabled} emailEnabled={emailSendEnabled}
                    noteText={noteText} onNoteChange={setNoteText} noteSaving={noteSaving} onAddNote={() => handleAddNote('Internal')}
                    portalDraft={portalDraft} onPortalChange={setPortalDraft} onSend={sendOnChannel}
                    smsRecipient={smsRecipient} onSmsRecipientChange={setSmsRecipient}
                    onLogCall={handleLogCall} onEmailSent={() => { void retryMessages(); router.refresh() }}
                  />}
                  tasks={<><div className="mb-3 flex items-center justify-between text-sm"><span>Tasks · {taskCounts.open} open</span><Button variant="link" size="sm" onClick={() => setActiveTab('tasks')}>View all</Button></div>{taskPreview.some(task => task.key !== workSummary?.workKey) ? <ul className="space-y-3">{taskPreview.filter(task => task.key !== workSummary?.workKey).map(task => <li key={task.key}><Link className="block text-sm underline-offset-4 hover:underline" href={task.href}>{task.title}</Link></li>)}</ul> : currentEngineStageTask && workSummary?.workKey !== `task:${currentEngineStageTask.id}` ? <MatterEngineStageTaskCard compact task={currentEngineStageTask} onUpdated={handleEngineStageTaskUpdated} /> : <p className="text-xs text-muted-foreground">{taskCounts.open ? 'View all tasks for the full list.' : 'No open tasks.'}</p>}</>}
                />
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
                <RecordTabHeader
                  title="Documents"
                  description={documentView === 'signing'
                    ? 'The signing checklist and ceremony record for the drafted documents.'
                    : 'Drafts, client uploads, and shared files for this matter.'}
                  actions={
                    <ViewSwitch
                      value={documentView}
                      options={DOCUMENT_VIEW_OPTIONS}
                      onChange={view => setTabView('documents', view, 'files')}
                      label="Documents view"
                    />
                  }
                />
                {documentView === 'signing' ? (
                  <MatterSigningPanel matterId={matterId} />
                ) : (
                  <>
                    {(documentsError || foldersError) && (
                      <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">
                        <p>{documentsError || foldersError}</p>
                        <Button variant="outline" size="sm" disabled={docsLoading} onClick={() => void loadDocuments()}>Retry</Button>
                      </div>
                    )}
                    <RequestedDocumentsCard matterId={matterId} onChanged={loadDocuments} probate={showProbate} />
                    <MatterDocumentsTab
                      matterId={matterId}
                      clientName={matter.client_name}
                      deepLinkedDocumentId={searchParams.get('document')}
                      initialScope={searchParams.get('scope') === 'unreviewed' ? 'unreviewed'
                        : searchParams.get('scope') === 'shared' ? 'shared'
                          : searchParams.get('scope') === 'client' ? 'client' : 'all'}
                      onScopeChange={scope => {
                        const params = new URLSearchParams(searchParams.toString())
                        if (scope === 'all') params.delete('scope')
                        else params.set('scope', scope)
                        params.delete('document')
                        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
                      }}
                      documents={documents}
                      folders={documentFolders}
                      loading={docsLoading}
                      loadError={documentsError}
                      onDocumentsChanged={loadDocuments}
                      unreviewedUploadCounts={unreviewedUploadCounts}
                      onReviewPortalUploads={handleMarkPortalUploadsReviewed}
                      onReviewIntakeUploads={openIntakeSheet}
                      esignDocumentsEnabled={esignDocumentsEnabled}
                      signatureRequests={signatureRequests}
                      defaultSigner={matter.client_email
                        ? { name: matter.client_name ?? '', email: matter.client_email }
                        : null}
                    />
                  </>
                )}
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
                handleDeleteLeadNote={handleDeleteLeadNote}
                handleUpdateLeadNote={handleUpdateLeadNote}
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
                  loading={activityLoading}
                  olderCursor={activityCursor}
                  loadingOlder={loadingOlderActivity}
                  onLoadOlder={() => void loadOlderActivity()}
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <ImportIntakeDialog
        open={importIntakeOpen}
        onOpenChange={setImportIntakeOpen}
        accessToken={token}
        parseTextUrl={`/api/admin/matters/${matterId}/parse-intake`}
        parseDocxUrl={`/api/admin/matters/${matterId}/parse-intake-docx`}
        onParsed={(parsedIntakeId) => {
          setLiveIntakeId(parsedIntakeId)
          setIntakeCompleted(false)
          setImportIntakeOpen(false)
          setIntakeSheetOpen(true)
          router.refresh()
        }}
      />

      {intakeSheetOpen && (
        <AdminIntakeSheet
          leadId={null}
          matterId={matterId}
          clientIntakeId={liveIntakeId}
          clientUserId={clientIntakeRow?.client_user_id ?? clientIntakeRow?.user_id ?? null}
          practiceArea={practiceAreaLabel(matterDetails?.practice_area ?? matter.practice_area)}
          clientName={matter.client_name || matter.matter_name || 'Client'}
          open={intakeSheetOpen}
          onClose={() => setIntakeSheetOpen(false)}
          onIntakeIdChange={setLiveIntakeId}
          onSubmitted={() => {
            setIntakeCompleted(true)
            setIntakeSheetOpen(false)
            router.refresh()
          }}
        />
      )}

      <SendSchedulingLinkDialog
        target={{ kind: 'matter', id: matterId }}
        open={schedulingLinkOpen}
        onOpenChange={setSchedulingLinkOpen}
      />

      <BookCalendlyDialog
        target={{ kind: 'matter', id: matterId }}
        open={bookForClientOpen}
        onOpenChange={setBookForClientOpen}
      />

      <Dialog open={deleteOpen} onOpenChange={open => (open ? setDeleteOpen(true) : closeDeleteDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete matter?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{matterLabel}</span>,
              including intake, documents, design sheet, messages, and activity. This cannot be undone.
              Closing or archiving the matter keeps all of it.
            </DialogDescription>
          </DialogHeader>
          {deleteWarning && (
            <div className="space-y-3">
              <p className="rounded-md border border-red-strong-border bg-red-strong-bg p-3 text-sm text-red-strong">
                {deleteWarning}
              </p>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">
                  Type <span className="font-semibold text-foreground">DELETE</span> to confirm.
                </span>
                <Input
                  autoFocus
                  value={deleteConfirmText}
                  onChange={event => setDeleteConfirmText(event.target.value)}
                  aria-label="Type DELETE to confirm"
                  placeholder="DELETE"
                />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDeleteDialog} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteMatter(deleteWarning !== null)}
              disabled={deleting || (deleteWarning !== null && deleteConfirmText.trim() !== 'DELETE')}
            >
              {deleting ? 'Deleting…' : deleteWarning ? 'Permanently delete' : 'Delete matter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteNoteTarget !== null} onOpenChange={open => !open && setDeleteNoteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const note = deleteNoteTarget
                setDeleteNoteTarget(null)
                if (note) void confirmDeleteLeadNote(note)
              }}
            >
              Delete note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unlockConfirmOpen} onOpenChange={setUnlockConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-open the submitted intake?</AlertDialogTitle>
            <AlertDialogDescription>
              The client will be able to edit and resubmit their intake questionnaire.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmUnlockIntake()}>Unlock intake</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={stagePreflight !== null}
        onOpenChange={open => { if (!open && !stageSaving) setStagePreflight(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Advance with open lifecycle blockers?</AlertDialogTitle>
            <AlertDialogDescription>
              Cornerstone found the following requirements before {stagePreflight ? stageLabel(stagePreflight.stage) : 'the selected stage'}.
              The stage has not changed. Confirm only if you have reviewed these exceptions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-2 text-sm">
            {(stagePreflight?.blockers ?? []).map(blocker => (
              <li key={blocker.key} className="rounded-md border p-2">
                <span className="font-medium">{blocker.label}</span>
                <span className="ml-1 text-muted-foreground">· {blocker.owner.replaceAll('_', ' ')}</span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stageSaving}>Keep current stage</AlertDialogCancel>
            <AlertDialogAction
              disabled={stageSaving || !stagePreflight}
              onClick={event => {
                event.preventDefault()
                if (stagePreflight) {
                  const preflight = stagePreflight
                  void handleStageChange(preflight.stage, {
                    version: preflight.version,
                    blockerKeys: preflight.blockers.map(blocker => blocker.key),
                  })
                }
              }}
            >
              {stageSaving ? 'Updating…' : 'Confirm exception and advance'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CommunicationDialog
        open={composerChannel !== null}
        channel={composerChannel ?? 'email'}
        target={{ type: 'matter', id: matter.matter_id, recipient: 'client' }}
        recipientName={matter.client_name ?? 'Client'}
        recipientEmail={matter.client_email ?? null}
        recipientPhone={matter.client_phone ?? null}
        token={token}
        onOpenChange={open => { if (!open) setComposerChannel(null) }}
        onSent={() => {
          toast.success(composerChannel === 'sms' ? 'Text sent' : 'Email sent')
          router.refresh()
        }}
      />
      {confirmDialog}
    </div>
  )
}
