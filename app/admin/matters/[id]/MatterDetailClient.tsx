'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  Loader as Loader2,
  MoreHorizontal,
  Trash2,
  Upload,
  Clock as UnlockIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { listDocuments } from '@/lib/documents'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
import type { MatterAgingSummary } from '@/lib/queries/matterOverview'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import {
  stageLabel,
  STAGES,
  type MatterActivity,
  type MatterContact,
  type MatterDocument,
  type MatterStage,
  type PipelineMatter,
} from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import {
  type CommunicationChannel,
  type MatterTab,
  parseCommunicationChannel,
  parseMatterTab,
} from '@/lib/matterPageTabs'
import {
  mergeUnreviewedCounts,
  type UnreviewedUploadCounts,
} from '@/lib/matter/unreviewedUploads'
import { useMessagesRealtime } from '@/lib/messages/useMessagesRealtime'
import {
  resolveMatterIntake,
  unlockIntake,
  markIntakeUploadsReviewed,
  markPortalUploadsReviewed,
} from '@/app/actions/adminIntake'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { MatterEngineStageTaskCard } from '@/components/admin/MatterEngineStageTaskCard'
import { MatterOverviewHero } from './MatterOverviewHero'
import { MatterEssentialsCard } from './MatterEssentialsCard'
import { MatterLegalPlanCard } from './MatterLegalPlanCard'
import { MatterProbateEssentialsCard } from './MatterProbateEssentialsCard'
import { useMatterDetailsSave } from './useMatterDetailsSave'
import { MatterAssistantQuickPrompts } from '@/app/admin/components/MatterAssistantQuickPrompts'
import { MatterActivityTab } from './MatterActivityTab'
import { MatterAssetsTabContent } from './MatterOverviewAssets'
import { MatterPortalUploadsCard } from './MatterPortalUploadsCard'
import { MatterMeetingNotesCard } from './MatterMeetingNotesCard'
import { IntakeSyncStatusCard } from './IntakeSyncStatusCard'
import { MatterOverviewSummaryCards } from './MatterOverviewSummaryCards'
import { MatterOverviewFactsRail } from './MatterOverviewFactsRail'
import { MatterProgressTimeline } from './MatterProgressTimeline'
import { MatterPeopleTab } from './MatterPeopleTab'
import { MatterDocumentsTab } from './MatterDocumentsTab'
import { useMatterNotes } from './useMatterNotes'
import { useMatterEngineStageTask } from './useMatterEngineStageTask'
import { MatterNotesTab, mergeLinkedNotes, type LinkedMatterNote } from './tabs/notes'
import { MatterCommunicationsTab } from './tabs/messages'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('./ImportIntakeDialog'), { ssr: false })

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
  matterDetails?: MatterDetailsRow | null
  designSheetPlanType?: string | null
  initialEstateSnapshot: MatterEstateSnapshot
  initialNotes?: MatterNoteRow[]
  initialLeadNotes?: Array<{ id: string; lead_id: string; body: string; created_at: string; note_type: 'internal' | 'system' }>
  initialMatterLinkedNotes?: LinkedMatterNote[]
  initialActivity?: MatterActivity[]
  designSheetSeeded?: boolean
  reviewFlags?: IntakeReadinessFlag[]
  resyncPreviewCount?: number
  smsEnabled?: boolean
  emailSendEnabled?: boolean
  esignEnabled?: boolean
  unreviewedUploadCounts?: UnreviewedUploadCounts
}

type PortalMessage = {
  id: string
  body: string
  sender_role: string
  created_at: string
  read_at: string | null
}

type SmsMessage = {
  id: string
  direction: string
  recipient_role: string | null
  recipient_name: string | null
  body: string
  status: string
  from_number: string | null
  to_number: string | null
  created_at: string
  actor_name: string | null
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
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
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
  matterDetails: initialMatterDetails = null,
  designSheetPlanType = null,
  initialEstateSnapshot,
  initialNotes = [],
  initialLeadNotes = [],
  initialMatterLinkedNotes = [],
  initialActivity = [],
  designSheetSeeded = false,
  reviewFlags = [],
  resyncPreviewCount = 0,
  smsEnabled = false,
  emailSendEnabled = false,
  esignEnabled = false,
  unreviewedUploadCounts: initialUnreviewedUploadCounts = { intake: 0, portal: 0, total: 0 },
}: MatterDetailClientProps) {
  const token = useAccessToken()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = parseMatterTab(searchParams.get('tab'))
  const communicationChannel = parseCommunicationChannel(searchParams.get('channel'))

  const [matter, setMatter] = useState(initialMatter)
  const [contacts, setContacts] = useState(initialContacts)
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialIntakeId)
  const [intakeCompleted, setIntakeCompleted] = useState(
    Boolean(clientIntakeRow?.intake_completed_at || matter.intake_status === 'completed'),
  )
  const [intakeSheetOpen, setIntakeSheetOpen] = useState(false)
  const [importIntakeOpen, setImportIntakeOpen] = useState(false)
  const [stageSaving, setStageSaving] = useState(false)
  const [sendingIntake, setSendingIntake] = useState(false)
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null)
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [matterNum, setMatterNum] = useState<string | null>(initialMatterNumber)
  const [unlocking, setUnlocking] = useState(false)
  const [portalUploadsOpen, setPortalUploadsOpen] = useState(false)
  const [unreviewedUploadCounts, setUnreviewedUploadCounts] = useState(initialUnreviewedUploadCounts)
  const [assetsTabVisited, setAssetsTabVisited] = useState(false)

  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([])
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalDraft, setPortalDraft] = useState('')
  const [portalSending, setPortalSending] = useState(false)

  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsDraft, setSmsDraft] = useState('')
  const [smsRecipient, setSmsRecipient] = useState<'client' | 'spouse'>('client')
  const [smsSending, setSmsSending] = useState(false)

  const [emailTo, setEmailTo] = useState(initialMatter.client_email || '')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSending, setEmailSending] = useState(false)

  const [activity, setActivity] = useState<MatterActivity[]>(initialActivity)
  const activityLoading = false

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
      if (field === 'signing_date' && typeof value === 'string') {
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

  const practiceArea = normalizePracticeArea(matterDetails?.practice_area ?? matter.practice_area)
  const showLegalPlan = practiceArea === 'EP-LP'
  const showProbate = practiceArea === 'Probate'

  const setActiveTab = useCallback((
    tab: MatterTab,
    section?: string,
    channel?: CommunicationChannel,
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
    }
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    if (section) {
      requestAnimationFrame(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [communicationChannel, pathname, router, searchParams])

  const scrollToIntakeActions = useCallback(() => {
    document.getElementById('matter-intake-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    if (activeTab === 'assets') setAssetsTabVisited(true)
  }, [activeTab])

  useEffect(() => {
    setMatter(initialMatter)
    setEmailTo(initialMatter.client_email || '')
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
    handleDeleteNote,
    handleUpdateNote,
    startEditingNote,
  } = useMatterNotes({ initialNotes, matterId, onActivityLogged: prependActivity })

  const [leadNotes, setLeadNotes] = useState(initialLeadNotes)
  const linkedNotes = useMemo(() => mergeLinkedNotes(
    leadNotes.map(note => ({ id: note.id, sourceId: note.id, origin: 'lead' as const, leadId: note.lead_id, body: note.body, created_at: note.created_at, note_type: note.note_type })),
    notes.map(note => initialMatterLinkedNotes.find(linked => linked.sourceId === note.id) ?? ({ id: note.id, sourceId: note.id, origin: 'matter' as const, body: note.body, created_at: note.created_at, note_type: note.note_type })),
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
  } = useMatterEngineStageTask(matterId, matter.stage)

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

  const handleReviewUploads = useCallback(() => {
    if (unreviewedUploadCounts.intake > 0) {
      void openIntakeSheet()
      return
    }
    if (unreviewedUploadCounts.portal > 0) {
      setPortalUploadsOpen(true)
      void handleMarkPortalUploadsReviewed()
      window.requestAnimationFrame(() => {
        document.getElementById('portal-uploads')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [handleMarkPortalUploadsReviewed, openIntakeSheet, unreviewedUploadCounts.intake, unreviewedUploadCounts.portal])

  const loadPortalMessages = useCallback(async () => {
    if (!token) return
    setPortalLoading(true)
    try {
      const res = await fetch(`/api/messages?matter_id=${encodeURIComponent(matter.matter_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => [])
      if (res.ok) setPortalMessages(Array.isArray(body) ? body : [])
    } catch {
      /* ignore */
    } finally {
      setPortalLoading(false)
    }
  }, [token, matter.matter_id])

  const loadSmsMessages = useCallback(async () => {
    if (!token) return
    setSmsLoading(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/sms-messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => [])
      if (res.ok) setSmsMessages(Array.isArray(body) ? body : [])
    } catch {
      /* ignore */
    } finally {
      setSmsLoading(false)
    }
  }, [token, matter.matter_id])

  useEffect(() => {
    void loadPortalMessages()
    void loadSmsMessages()
  }, [loadPortalMessages, loadSmsMessages])

  const handlePortalMessageInsert = useCallback((message: PortalMessage) => {
    setPortalMessages(current => {
      if (current.some(row => row.id === message.id)) return current
      return [...current, message]
    })
  }, [])

  useMessagesRealtime(matter.matter_id, handlePortalMessageInsert)

  const sendPortalMessage = async () => {
    if (!token || !portalDraft.trim()) return
    setPortalSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ matter_id: matter.matter_id, body: portalDraft.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Send failed')
      setPortalDraft('')
      toast.success('Message sent')
      await loadPortalMessages()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send message')
    } finally {
      setPortalSending(false)
    }
  }

  const sendSms = async () => {
    if (!token || !smsDraft.trim()) return
    setSmsSending(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/send-sms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient: smsRecipient, body: smsDraft.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'SMS failed')
      setSmsDraft('')
      toast.success('Text sent')
      await loadSmsMessages()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send SMS')
    } finally {
      setSmsSending(false)
    }
  }

  const sendEmail = async () => {
    if (!token || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return
    setEmailSending(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/send-email`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: emailTo.trim(),
          subject: emailSubject.trim(),
          text: emailBody.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Email failed')
      setEmailSubject('')
      setEmailBody('')
      toast.success(body.provider === 'graph' ? 'Email sent via Outlook' : 'Email sent')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send email')
    } finally {
      setEmailSending(false)
    }
  }

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true)
    try {
      const docs = await listDocuments(matter.matter_id)
      setDocuments(docs)
    } catch {
      setDocuments([])
    } finally {
      setDocsLoading(false)
    }
  }, [matter.matter_id])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  const handleStageChange = async (stage: MatterStage) => {
    if (!token || stage === matter.stage) return
    setStageSaving(true)
    const previous = matter.stage
    setMatter(m => ({ ...m, stage }))
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stage }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not update stage')
      toast.success(`Stage updated to ${stageLabel(stage)}`)
      router.refresh()
    } catch (e) {
      setMatter(m => ({ ...m, stage: previous }))
      toast.error(e instanceof Error ? e.message : 'Could not update stage')
    } finally {
      setStageSaving(false)
    }
  }

  const handleSendIntake = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSendingIntake(true)
    setIntakeUrl(null)
    try {
      const res = await fetch('/api/admin/intake/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ matterId: matter.matter_id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not send intake')
      if (typeof body.url === 'string') setIntakeUrl(body.url)
      setMatter(m => ({
        ...m,
        intake_sent_at: new Date().toISOString(),
        intake_status: m.intake_status === 'completed' ? m.intake_status : 'sent',
      }))
      toast.success('Intake link ready')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send intake')
    } finally {
      setSendingIntake(false)
    }
  }

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

  const copyIntakeUrl = async () => {
    if (!intakeUrl) return
    try {
      await navigator.clipboard.writeText(intakeUrl)
      toast.success('Intake link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const handleDeleteMatter = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
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
  const unreadPortalCount = useMemo(
    () => portalMessages.filter(m => m.sender_role === 'client' && !m.read_at).length,
    [portalMessages],
  )
  const lastPortalMessage = portalMessages.length > 0 ? portalMessages[portalMessages.length - 1] : null

  const healthLabel = agingSummary?.isSnoozed
    ? null
    : agingSummary?.health === 'red'
      ? 'Stalled'
      : agingSummary?.health === 'amber'
        ? 'Needs attention'
        : agingSummary?.health === 'green'
          ? 'On track'
          : null
  const healthClass = agingSummary?.health === 'red'
    ? 'border-red-strong-border bg-red-strong-bg text-red-strong'
    : agingSummary?.health === 'amber'
      ? 'border-amber-border bg-amber-bg text-amber'
      : 'border-green/40 bg-green-bg text-green'

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-8">
        <div className="w-full max-w-[1280px]">
        <div className="mb-3">
          <Link
            href="/admin/matters"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Matters
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {matter.client_name || matter.matter_name || 'Matter'}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{matterNum ? `#${matterNum}` : 'Matter number —'}</span>
              <span aria-hidden>·</span>
              <span>{practiceAreaLabel(matterDetails?.practice_area ?? matter.practice_area)}</span>
              {agingSummary && (
                <>
                  <span aria-hidden>·</span>
                  <span>{agingSummary.daysInStage} business day{agingSummary.daysInStage === 1 ? '' : 's'} in {stageLabel(matter.stage)}</span>
                </>
              )}
              {healthLabel && (
                <Badge variant="outline" className={`text-[10px] ${healthClass}`}>{healthLabel}</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={matter.stage}
              onValueChange={value => void handleStageChange(value as MatterStage)}
              disabled={stageSaving}
            >
              <SelectTrigger size="sm" className="w-[150px]" aria-label="Matter stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGES.map(stage => (
                  <SelectItem key={stage.key} value={stage.key}>{stage.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Intake actions
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void openIntakeSheet()}>
                  <ClipboardList className="mr-2 h-3.5 w-3.5" />
                  {intakeCompleted ? 'Edit intake' : liveIntakeId ? 'Update intake' : 'Create intake'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportIntakeOpen(true)}>
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  Import intake — paste text or upload Word
                </DropdownMenuItem>
                {intakeCompleted && liveIntakeId && (
                  <DropdownMenuItem onClick={() => void handleUnlockIntake()} disabled={unlocking}>
                    {unlocking ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <UnlockIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    Unlock intake for client editing
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" aria-label="More actions">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete matter
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        </div>
      </div>

      <div className="border-b border-border bg-background px-4 py-3 md:px-8">
        <div className="w-full max-w-[1280px]">
          <MatterProgressTimeline
            matter={matter}
            details={matterDetails}
            intakeCompletedAt={clientIntakeRow?.intake_completed_at ?? null}
          />
        </div>
      </div>

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

      <div className="flex-1 overflow-auto px-4 py-4 md:px-8">
        <Tabs
          value={activeTab}
          onValueChange={v => setActiveTab(v as MatterTab)}
          className="w-full max-w-[1280px] gap-4"
        >
          <TabsList className="sticky top-0 z-10 w-full justify-start overflow-x-auto bg-background">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="people">People {contacts.length}</TabsTrigger>
            <TabsTrigger value="assets">Assets {initialEstateSnapshot.assetCount}</TabsTrigger>
            <TabsTrigger value="documents">Documents {documents.length}</TabsTrigger>
            <TabsTrigger value="communications" className="gap-1.5">
              Communications
              {unreadPortalCount > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] tabular-nums">
                  {unreadPortalCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
              <div className="space-y-4">
            <MatterOverviewHero
              matter={matter}
              nextAction={nextAction}
              unreadPortalCount={unreadPortalCount}
              unreviewedUploadCounts={unreviewedUploadCounts}
              reviewFlags={reviewFlags}
              lastPortalMessage={lastPortalMessage}
              onIntakeActionClick={scrollToIntakeActions}
              onEngagementActionClick={() => void handleSendEngagement()}
              onUnreadClick={() => setActiveTab('communications', undefined, 'portal')}
              onReviewFlagsClick={scrollToIntakeActions}
              onReviewUploads={handleReviewUploads}
              quickPrompts={
                <MatterAssistantQuickPrompts
                  className="flex flex-wrap gap-2"
                  prompts={[
                    { label: 'Summarize intake', prompt: "Summarize this client's situation" },
                    { label: 'Analyze MA estate tax', prompt: 'Analyze MA estate tax exposure' },
                  ]}
                />
              }
            />
            <MatterOverviewSummaryCards
              peopleCount={contacts.length}
              assetCount={initialEstateSnapshot.assetCount}
              documentCount={documents.length}
              engineStageTask={currentEngineStageTask}
              onNavigate={(tab, section) => setActiveTab(tab, section)}
            />
            <IntakeSyncStatusCard
              matterId={matterId}
              intakeCompleted={intakeCompleted}
              designSheetSeeded={designSheetSeeded}
              reviewFlags={reviewFlags}
              resyncPreviewCount={resyncPreviewCount}
              sendingIntake={sendingIntake}
              intakeUrl={intakeUrl}
              onSendIntake={() => void handleSendIntake()}
              onCopyIntakeUrl={() => void copyIntakeUrl()}
            />
            <MatterEssentialsCard
              matter={matter}
              matterId={matterId}
              matterNumber={matterNum}
              matterNumberManual={matterNumberManual}
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
            {showLegalPlan && (
              <MatterLegalPlanCard
                details={matterDetails}
                onSaveField={handleSaveMatterDetailField}
                savingField={savingField}
                lastSavedAt={lastSavedAt}
                error={matterDetailsError}
              />
            )}
            {showProbate && (
              <MatterProbateEssentialsCard
                details={matterDetails}
                onSaveField={handleSaveMatterDetailField}
                savingField={savingField}
                lastSavedAt={lastSavedAt}
                error={matterDetailsError}
              />
            )}
            {currentEngineStageTask && (
              <div id="matter-open-task" className="scroll-mt-24">
                <MatterEngineStageTaskCard
                  task={currentEngineStageTask}
                  onUpdated={handleEngineStageTaskUpdated}
                />
              </div>
            )}
            <MatterPortalUploadsCard
              matterId={matterId}
              open={portalUploadsOpen}
              onOpenChange={setPortalUploadsOpen}
              onOpened={() => void handleMarkPortalUploadsReviewed()}
            />
              </div>
              <MatterOverviewFactsRail
                matterId={matterId}
                details={matterDetails}
                designSheetPlanType={designSheetPlanType}
                estate={initialEstateSnapshot}
              />
            </div>
          </TabsContent>

          <MatterPeopleTab
            matterId={matterId}
            matter={matter}
            initialContacts={contacts}
          />

          <MatterAssetsTabContent
            matterId={matterId}
            matter={matter}
            intakeId={liveIntakeId}
            enabled={assetsTabVisited}
          />

          <TabsContent value="documents" className="space-y-4">
            <MatterDocumentsTab
              matterId={matterId}
              clientName={matter.client_name}
              deepLinkedDocumentId={searchParams.get('document')}
              documents={documents}
              loading={docsLoading}
              onDocumentsChanged={loadDocuments}
              unreviewedUploadCounts={unreviewedUploadCounts}
              onReviewPortalUploads={handleMarkPortalUploadsReviewed}
              onReviewIntakeUploads={openIntakeSheet}
            />
          </TabsContent>

          <MatterCommunicationsTab
            matterId={matter.matter_id}
            channel={communicationChannel}
            onChannelChange={channel => setActiveTab('communications', undefined, channel)}
            portalMessages={portalMessages}
            portalLoading={portalLoading}
            portalDraft={portalDraft}
            portalSending={portalSending}
            smsMessages={smsMessages}
            smsLoading={smsLoading}
            smsDraft={smsDraft}
            smsRecipient={smsRecipient}
            smsSending={smsSending}
            emailTo={emailTo}
            emailSubject={emailSubject}
            emailBody={emailBody}
            emailSending={emailSending}
            smsEnabled={smsEnabled}
            emailSendEnabled={emailSendEnabled}
            setPortalDraft={setPortalDraft}
            setSmsDraft={setSmsDraft}
            setSmsRecipient={setSmsRecipient}
            setEmailTo={setEmailTo}
            setEmailSubject={setEmailSubject}
            setEmailBody={setEmailBody}
            onSendPortal={() => void sendPortalMessage()}
            onSendSms={() => void sendSms()}
            onSendEmail={() => void sendEmail()}
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
            handleDeleteNote={handleDeleteNote}
            handleUpdateNote={handleUpdateNote}
            handleDeleteLeadNote={handleDeleteLeadNote}
            handleUpdateLeadNote={handleUpdateLeadNote}
            startEditingNote={startEditingNote}
            meetingNotes={<MatterMeetingNotesCard matterId={matterId} defaultOpen />}
          />

          <TabsContent value="activity">
            <MatterActivityTab activity={activity} loading={activityLoading} />
          </TabsContent>
        </Tabs>
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

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete matter?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{matterLabel}</span>,
              including intake, documents, design sheet, messages, and activity. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteMatter()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete matter'}
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
    </div>
  )
}
