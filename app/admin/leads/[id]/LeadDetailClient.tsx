'use client'

import Link from 'next/link'
import { ArrowLeft, Users } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { openExternalPhone } from '@/lib/clientPhone'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { copyToClipboard } from '@/lib/clipboard'
import { phoneTelHref } from '@/lib/phone'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'
import type { LeadEditableField } from '@/lib/leads/details'
import { parseLeadTab, type LeadTab } from '@/lib/leads/leadPageTabs'
import { parseTaskView, type TaskView } from '@/lib/matterPageTabs'
import { computeNextAction, type NextAction } from '@/lib/leads/nextAction'
import { leadOperationalBrief } from '@/lib/lifecycle/lead'
import type {
  LeadTimelineMeeting,
  LeadTimelineNote,
} from '@/lib/leads/timeline'
import { newestTimestamp } from '@/lib/leads/timeline'
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
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { MobileRecordSectionSelect } from '@/components/admin/MobileRecordSectionSelect'
import { RecordTasksTab, TASK_VIEW_OPTIONS } from '@/components/tasks/RecordTasksTab'
import { ViewSwitch } from '@/components/ViewSwitch'
import { RecordTabHeader } from '@/components/RecordTabHeader'
import { EmptyState } from '@/components/EmptyState'
import { Card } from '@/components/ui/card'
import { OperationalBrief } from '@/components/lifecycle/OperationalBrief'
import { useRecordTaskCounts } from '@/components/tasks/useRecordTaskCounts'
import type { RecordTaskCounts } from '@/lib/tasks/types'
import { LeadFieldsRail, LEAD_DETAIL_RAIL_WIDTH } from '@/components/leads/LeadFieldsRail'
import {
  LeadChannelsCard,
  type LeadChannelField,
  type LeadChannelTarget,
} from '@/components/leads/LeadChannelsCard'
import { LeadKeyDatesCard, type LeadKeyDates } from '@/components/leads/LeadKeyDatesCard'
import { LeadConflictCard } from '@/components/leads/LeadConflictCard'
import type { ConflictCheckState } from '@/lib/conflicts/match'
import type { ContactChannel } from '@/lib/contacts/additionalChannels'
import { LeadNextAction } from '@/components/leads/LeadNextAction'
import { LeadScoreCard } from '@/components/leads/LeadScoreCard'
import { computeLeadScore, leadScoreInputFromRow, type LeadScoreInput } from '@/lib/leads/score'
import { clientContactTimestamps } from '@/lib/leads/contactEvents'
import { LeadOverview, leadProgressLabel, leadDisplayDate } from '@/components/leads/LeadOverview'
import { agreementSentInApp, effectiveEngagementStatus } from '@/lib/leads/engagementStatus'
import { LeadSnoozeDialog } from '@/components/leads/LeadSnoozeDialog'
import { LeadDocumentsTab, useLeadDocuments } from '@/components/leads/LeadDocumentsTab'
import { LeadTopActions } from '@/components/leads/LeadTopActions'
import { provisionalLeadNumber } from '@/components/leads/LeadsTable'
import { CommunicationDialog } from '@/components/comms/CommunicationDialog'
import { RecordCommunicationsCard } from '@/components/comms/RecordCommunicationsCard'
import { LeadTimelineCard } from '@/components/leads/LeadTimelineCard'
import {
  isMobileDetailViewport,
  ResponsiveDetailRail,
} from '@/components/layout/ResponsiveDetailRail'
import { intakeTrackLabel, type IntakeTrack } from '@/lib/intakeTrack'
import { LeadIntakeCard } from './LeadIntakeCard'
import { SendSchedulingLinkDialog } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BookCalendlyDialog } from '@/components/scheduling/BookCalendlyDialog'
import type {
  LeadActivityViewRow,
  LeadDetailRecord,
  LeadSpouseRecord,
  MutableLeadStatus,
} from '@/lib/leads/viewTypes'
import type { MatterContact, PipelineMatter } from '@/types/database'
import { MatterPeopleTabContent } from '@/app/admin/matters/[id]/MatterPeopleTab'
import { useConfirm } from '@/components/useConfirm'
import { usePushToLawmatics } from '@/hooks/usePushToLawmatics'
import { usePushToStatular } from '@/hooks/usePushToStatular'
import { RecordWorkStrip } from '@/components/work/RecordWorkIndicator'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('@/app/admin/matters/[id]/ImportIntakeDialog'), { ssr: false })
const MatterAssetsTab = dynamic(
  () => import('@/app/admin/matters/[id]/tabs/assets').then(module => ({ default: module.MatterAssetsTab })),
  { ssr: false, loading: () => <p className="text-xs text-muted-foreground">Loading assets…</p> },
)

type LeadRecord = LeadDetailRecord
type LeadSpouse = LeadSpouseRecord
type LeadActivityRow = LeadActivityViewRow

const EMPTY_NOTES: LeadTimelineNote[] = []
const EMPTY_MEETINGS: LeadTimelineMeeting[] = []

const LEAD_SECTION_OPTIONS: readonly { value: LeadTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'intake', label: 'Intake' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'people', label: 'People' },
  { value: 'assets', label: 'Assets' },
  { value: 'documents', label: 'Documents' },
  { value: 'communications', label: 'Messages' },
  { value: 'notes', label: 'Notes' },
]

type LeadDetailClientProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  initialActivity: LeadActivityRow[]
  initialNotes?: LeadTimelineNote[]
  initialMeetingNotes?: LeadTimelineMeeting[]
  actorNames?: Record<string, string>
  firmTimezone?: string
  nextAppointmentAt?: string | null
  lastTouchAt?: string | null
  actorError?: string | null
  currentUser?: { id: string; role: string }
  activeAgreement?: { id: string; status?: string } | null
  initialScoreInput?: LeadScoreInput | null
  lastClientResponseAt?: string | null
  recordUpdatedAt?: string | null
  /** Null when the opportunity has no matter row to hang the SLA clock on. */
  initialKeyDates?: LeadKeyDates | null
  peopleMatter?: PipelineMatter | null
  initialPeopleContacts?: MatterContact[]
  initialTaskCounts?: RecordTaskCounts
  initialIntakeUrl?: string | null
  initialIntakeLinkRevoked?: boolean
  smsEnabled?: boolean
  /** firm_settings.esign_documents_enabled — sending a document for signature. */
  esignDocumentsEnabled?: boolean
  workSummary?: import('@/lib/work/recordSummary').RecordWorkSummary | null
  /** The lead's conflict-of-interest check; null when none has run yet. */
  initialConflictCheck?: ConflictCheckState | null
}

type LeadPatchResponse = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  activity?: LeadActivityRow
  refreshWarning?: string
  matterId?: string
}

type SnoozeResponse = {
  lead: LeadRecord
  activity: LeadActivityRow
}


function calendarDaysAgo(value: string | null | undefined, timeZone: string): number | null {
  if (!value) return null
  const days = calendarDayDifference(Date.now(), value, timeZone)
  return days === null ? null : Math.max(0, days)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function mergeHydratedLead(
  current: LeadRecord,
  saved: LeadRecord,
  savedSpouse: LeadSpouse | null,
): LeadRecord {
  const next: LeadRecord = { ...current, ...saved }
  if (!savedSpouse) {
    delete next._spouse
    return next
  }
  const currentSpouse = isRecord(current._spouse) ? current._spouse : {}
  next._spouse = {
    ...currentSpouse,
    first_name: savedSpouse.first_name ?? '',
    middle_name: savedSpouse.middle_name ?? '',
    last_name: savedSpouse.last_name ?? '',
    preferred_name: savedSpouse.preferred_name ?? '',
    email: savedSpouse.email ?? '',
    phone: savedSpouse.phone ?? '',
    date_of_birth: savedSpouse.date_of_birth ?? '',
  }
  return next
}

export function LeadDetailClient({
  lead: initialLead,
  spouse: initialSpouse,
  initialActivity,
  initialNotes = EMPTY_NOTES,
  initialMeetingNotes = EMPTY_MEETINGS,
  actorNames = {},
  firmTimezone = FIRM_TIMEZONE,
  nextAppointmentAt = null,
  lastTouchAt,
  lastClientResponseAt = null,
  recordUpdatedAt = null,
  initialScoreInput = null,
  actorError = null,
  currentUser = { id: '', role: '' },
  activeAgreement = null,
  initialKeyDates = null,
  peopleMatter = null,
  initialPeopleContacts = [],
  initialTaskCounts = { open: 0, overdue: 0 },
  initialIntakeUrl = null,
  initialIntakeLinkRevoked = false,
  smsEnabled = true,
  esignDocumentsEnabled = false,
  workSummary = null,
  initialConflictCheck = null,
}: LeadDetailClientProps) {
  const { confirm, confirmDialog } = useConfirm()
  const token = useAccessToken()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [lead, setLead] = useState(initialLead)
  const [spouse, setSpouse] = useState(initialSpouse)
  const [conflictCheck, setConflictCheck] = useState<ConflictCheckState | null>(initialConflictCheck)
  const [activeField, setActiveField] = useState<LeadEditableField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState(initialActivity)
  const [notes, setNotes] = useState(initialNotes)
  const [meetingNotes, setMeetingNotes] = useState(initialMeetingNotes)
  const [noteRequest, setNoteRequest] = useState(0)
  const [tasksVersion, setTasksVersion] = useState(0)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [intakeSection, setIntakeSection] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyIntent, setBusyIntent] = useState<string | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [intakeSheetOpen, setIntakeSheetOpen] = useState(false)
  const [importIntakeOpen, setImportIntakeOpen] = useState(false)
  const [schedulingLinkOpen, setSchedulingLinkOpen] = useState(false)
  const [bookForClientOpen, setBookForClientOpen] = useState(false)
  const [communicationChannel, setCommunicationChannel] = useState<'email' | 'sms' | null>(null)
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialLead.id)
  const [intakeUrl, setIntakeUrl] = useState<string | null>(initialIntakeUrl)
  const [intakeLinkRevoked, setIntakeLinkRevoked] = useState(initialIntakeLinkRevoked)
  const [sendingIntake, setSendingIntake] = useState(false)
  const [intakeLinkBusy, setIntakeLinkBusy] = useState(false)
  const [communicationInitialMessage, setCommunicationInitialMessage] = useState<string | undefined>()
  const [keyDates, setKeyDates] = useState<LeadKeyDates | null>(initialKeyDates)
  const [keyDatesSaving, setKeyDatesSaving] = useState(false)

  useEffect(() => {
    if (!isMobileDetailViewport()) setRailOpen(true)
  }, [])
  const [spouseRemovalError, setSpouseRemovalError] = useState<string | null>(null)
  const [dataRefreshWarning, setDataRefreshWarning] = useState<string | null>(null)
  const [activityRefreshWarning, setActivityRefreshWarning] = useState<string | null>(null)
  const [localTouchAt, setLocalTouchAt] = useState<string | null>(null)
  const initialLeadRef = useRef(initialLead)
  const interactionBusy = busy
    || sendingIntake
    || activeField !== null
    || busyIntent !== null
  const interactionLockRef = useRef(false)
  const {
    documents,
    folders: documentFolders,
    signatureRequests,
    loading: documentsLoading,
    error: documentsError,
    reload: reloadDocuments,
  } = useLeadDocuments(lead.matter_id)
  const taskCounts = useRecordTaskCounts(lead.id, initialTaskCounts)

  // The URL owns the tab, but the click applies immediately so the workspace
  // never waits on a router round trip.
  const urlTab = parseLeadTab(searchParams?.get('tab'))
  const taskView = parseTaskView(searchParams?.get('view'))
  const [activeTab, setActiveTab] = useState<LeadTab>(urlTab)
  useEffect(() => { setActiveTab(urlTab) }, [urlTab])

  function changeTab(tab: LeadTab) {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (tab === 'overview') params.delete('tab')
    else params.set('tab', tab)
    if (tab !== 'tasks') params.delete('view')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ''), { scroll: false })
  }

  function changeTaskView(view: TaskView) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('tab', 'tasks')
    if (view === 'queue') params.delete('view')
    else params.set('view', view)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ''), { scroll: false })
  }

  function beginInteraction() {
    if (interactionBusy || interactionLockRef.current) return false
    interactionLockRef.current = true
    return true
  }

  function endInteraction() {
    interactionLockRef.current = false
  }

  useEffect(() => {
    if (initialLeadRef.current.updated_at === initialLead.updated_at) return
    initialLeadRef.current = initialLead
    setLead(initialLead)
  }, [initialLead])

  useEffect(() => { setKeyDates(initialKeyDates) }, [initialKeyDates])
  useEffect(() => { setActivity(initialActivity) }, [initialActivity])
  useEffect(() => { setNotes(initialNotes) }, [initialNotes])
  useEffect(() => { setMeetingNotes(initialMeetingNotes) }, [initialMeetingNotes])

  async function call<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await response.json() as T & { error?: string; fieldErrors?: Record<string, string> }
    if (!response.ok) {
      throw Object.assign(new Error(json.error || 'Request failed'), { fieldErrors: json.fieldErrors })
    }
    return json
  }

  function openField(field: LeadEditableField | null) {
    if (field) setRailOpen(true)
    if (field !== 'spouse') setSpouseRemovalError(null)
    setActiveField(field)
  }

  function addQuickNote() {
    changeTab('notes')
    setNoteRequest(value => value + 1)
  }

  function tasksChanged() {
    setTasksVersion(value => value + 1)
    void taskCounts.refresh()
  }

  async function refreshActivity() {
    const json = await call<{ activity?: LeadActivityRow[] }>(`/api/admin/leads/${lead.id}/activity`, undefined, 'GET')
    setActivity(Array.isArray(json.activity) ? json.activity : [])
    setActivityRefreshWarning(null)
  }

  /**
   * Record (or undo) an engagement sent outside the app — emailed, or through
   * another e-sign service. The matter-details route owns this status for the
   * opportunity and mirrors it onto the lead, the same as the matter page's
   * Engagement dropdown.
   */
  async function markEngagementSentOutside(sent: boolean) {
    if (!lead.matter_id) return
    const value = sent ? 'sent' : activeAgreement ? 'draft' : 'not_sent'
    try {
      await call('/api/admin/matter-details', { matterId: lead.matter_id, field: 'engagement_status', value }, 'PATCH')
      setLead(current => ({
        ...current,
        engagement_status: sent ? 'sent' : value === 'draft' ? 'draft' : null,
        engagement_sent_at: sent ? current.engagement_sent_at ?? new Date().toISOString() : null,
      }))
      toast.success(sent ? 'Engagement marked as sent' : 'Engagement no longer marked as sent')
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not update the engagement status')
    }
  }

  async function refreshActivityBestEffort() {
    try {
      await refreshActivity()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not refresh timeline'
      setActivityRefreshWarning(message)
    }
  }

  const { push: pushToLawmatics, pushing: pushingToLawmatics } = usePushToLawmatics(
    lead.id,
    () => void refreshActivityBestEffort(),
  )
  const { push: pushToStatular, pushing: pushingToStatular } = usePushToStatular(
    lead.id,
    () => void refreshActivityBestEffort(),
  )

  function recordTouch(value: string | null | undefined) {
    const timestamp = value && Number.isFinite(Date.parse(value))
      ? value
      : new Date(Date.now()).toISOString()
    setLocalTouchAt(current => newestTimestamp([current, timestamp]))
  }

  function applyLeadPatch(json: LeadPatchResponse) {
    setLead(current => mergeHydratedLead(current, json.lead, json.spouse))
    setSpouse(json.spouse)
    if (json.activity) {
      setActivity(current => [
        json.activity!,
        ...current.filter(row => row.id !== json.activity!.id),
      ])
    }
    setDataRefreshWarning(json.refreshWarning ?? null)
    router.refresh()
  }

  async function sendIntake() {
    setSendingIntake(true)
    setError(null)
    try {
      const json = await call<{ url?: string; email?: string }>('/api/admin/intake/send', { intakeId: lead.id })
      if (typeof json.url === 'string') setIntakeUrl(json.url)
      setLead(current => ({
        ...current,
        intake_sent_at: new Date().toISOString(),
        intake_status: current.intake_status === 'completed' ? current.intake_status : 'sent',
      }))
      await refreshActivityBestEffort()
      router.refresh()
      const deliveryWarnings: Record<string, string> = {
        suppressed: 'The intake link is ready, but email delivery was suppressed. Review delivery settings before retrying.',
        redirected: 'The intake email was redirected to a test inbox. It was not sent to the client.',
        logged: 'The intake link is ready, but email was only logged. Configure email delivery before retrying.',
        error: 'The intake link is ready, but the email could not be sent. Please retry sending it.',
      }
      if (json.email && deliveryWarnings[json.email]) setError(deliveryWarnings[json.email])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send intake')
    } finally {
      setSendingIntake(false)
    }
  }

  async function changeIntakeTrack(track: IntakeTrack) {
    setIntakeLinkBusy(true)
    try {
      await call('/api/admin/intake/track', { intakeId: lead.id, track })
      setLead(current => ({ ...current, intake_track: track }))
      toast.success(`Now using the ${intakeTrackLabel(track)} questionnaire`)
      await refreshActivityBestEffort()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the questionnaire')
    } finally {
      setIntakeLinkBusy(false)
    }
  }

  /**
   * Leads created from a booking never had a standing link written, so the
   * copy button used to sit greyed out with no way forward. The GET issues one
   * on demand and — unlike the rotate POST — refuses to revive a link the firm
   * revoked on purpose.
   */
  async function ensureIntakeUrl(): Promise<string> {
    const json = await call<{ url: string | null }>(
      `/api/admin/intake/link?intakeId=${encodeURIComponent(lead.id)}`,
      undefined,
      'GET',
    )
    if (!json.url) {
      setIntakeLinkRevoked(true)
      throw new Error('This intake link was revoked. Prepare a new one before sharing it.')
    }
    setIntakeUrl(json.url)
    setIntakeLinkRevoked(false)
    return json.url
  }

  async function copyIntakeUrl() {
    if (intakeLinkRevoked || intakeLinkBusy) return
    setIntakeLinkBusy(true)
    try {
      // The pending value goes to the clipboard helper unawaited so the click's
      // user activation survives the round trip when a link has to be issued.
      const copied = await copyToClipboard(intakeUrl ?? ensureIntakeUrl())
      if (!copied) throw new Error('Could not copy intake link')
      setError(null)
      toast.success('Intake link copied')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not copy intake link'
      setError(message)
      toast.error(message)
    } finally {
      setIntakeLinkBusy(false)
    }
  }

  async function rotateIntakeUrl() {
    const replacing = Boolean(intakeUrl)
    if (replacing && !(await confirm({
      title: 'Replace this intake link?',
      body: 'The previous link stops working immediately, including for anyone part-way through the questionnaire.',
      confirmLabel: 'Replace link',
      destructive: true,
    }))) {
      return
    }
    setIntakeLinkBusy(true)
    try {
      const json = await call<{ url: string }>('/api/admin/intake/link', { intakeId: lead.id })
      setIntakeUrl(json.url)
      setIntakeLinkRevoked(false)
      toast.success(replacing ? 'Intake link replaced' : 'Intake link ready')
      await refreshActivityBestEffort()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not replace intake link')
    } finally {
      setIntakeLinkBusy(false)
    }
  }

  async function revokeIntakeUrl() {
    if (!(await confirm({
      title: 'Revoke this intake link?',
      body: 'It stops working until a new link is prepared.',
      confirmLabel: 'Revoke link',
      destructive: true,
    }))) return
    setIntakeLinkBusy(true)
    try {
      await call('/api/admin/intake/link', { intakeId: lead.id }, 'DELETE')
      setIntakeUrl(null)
      setIntakeLinkRevoked(true)
      toast.success('Intake link revoked')
      await refreshActivityBestEffort()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke intake link')
    } finally {
      setIntakeLinkBusy(false)
    }
  }

  async function persistStatus(status: MutableLeadStatus) {
    setError(null)
    setBusy(true)
    try {
      const json = await call<LeadPatchResponse>(
        `/api/admin/leads/${lead.id}`,
        { status },
        'PATCH',
      )
      applyLeadPatch(json)
      await refreshActivityBestEffort()
      if (json.matterId) router.push(`/admin/matters/${json.matterId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Secondary emails and phone numbers for the client or the spouse. They are
   * contact detail rather than lead qualification, so they take the channels
   * route instead of the audited field RPC.
   */
  async function saveChannels(
    target: LeadChannelTarget,
    field: LeadChannelField,
    channels: ContactChannel[],
  ) {
    try {
      const json = await call<{ value?: ContactChannel[] }>(
        `/api/admin/leads/${lead.id}/channels`,
        { target, field, value: channels },
        'PATCH',
      )
      const saved = json.value ?? channels
      if (target === 'client') setLead(current => ({ ...current, [field]: saved }))
      else setSpouse(current => (current ? { ...current, [field]: saved } : current))
      toast.success('Saved')
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save')
    }
  }

  /**
   * Discovery and PMPS dates belong to the opportunity's matter row, and
   * setting one also re-dates every SLA task waiting on that anchor — which is
   * what the sla-anchors route does in a single request. The rail edits them,
   * so the same write is available here without opening the SLA tab.
   */
  async function saveKeyDate(field: keyof LeadKeyDates, value: string | null) {
    if (!lead.matter_id) return
    setKeyDatesSaving(true)
    try {
      const json = await call<{ anchors?: LeadKeyDates; rescheduled?: number }>(
        `/api/admin/matters/${lead.matter_id}/sla-anchors`,
        { [field]: value },
        'PATCH',
      )
      setKeyDates({
        discoveryCallAt: json.anchors?.discoveryCallAt ?? null,
        pmpsAt: json.anchors?.pmpsAt ?? null,
      })
      toast.success(
        json.rescheduled
          ? `Saved — ${json.rescheduled} task${json.rescheduled === 1 ? '' : 's'} scheduled`
          : 'Saved',
      )
      await refreshActivityBestEffort()
      tasksChanged()
      router.refresh()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save the key date')
    } finally {
      setKeyDatesSaving(false)
    }
  }

  async function saveField(field: LeadEditableField, value: unknown) {
    if (field === 'spouse' && value !== null) setSpouseRemovalError(null)
    try {
      const json = await call<LeadPatchResponse>(
        `/api/admin/leads/${lead.id}`,
        { field, value },
        'PATCH',
      )
      applyLeadPatch(json)
      await refreshActivityBestEffort()
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Could not save field')
      throw caught
    }
  }

  function action(path: string, body?: unknown) {
    return async () => {
      setBusy(true)
      setError(null)
      try {
        const json = await call<{ matterId?: string; agreementId?: string }>(path, body)
        if (json.matterId) router.push(`/admin/matters/${json.matterId}`)
        else if (json.agreementId) router.push(`/admin/engagements/${json.agreementId}?step=design`)
        else router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Request failed')
      } finally {
        setBusy(false)
      }
    }
  }

  async function snoozeNextAction(nextActionSnoozedUntil: string | null) {
    const json = await call<SnoozeResponse>(
      `/api/admin/leads/${lead.id}`,
      { nextActionSnoozedUntil },
      'PATCH',
    )
    setLead(current => mergeHydratedLead(current, json.lead, spouse))
    setActivity(current => [
      json.activity,
      ...current.filter(row => row.id !== json.activity.id),
    ])
  }

  async function clearNextActionSnooze() {
    if (!beginInteraction()) return
    setBusyIntent('clear_snooze')
    setError(null)
    try {
      await snoozeNextAction(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear snooze')
    } finally {
      setBusyIntent(null)
      endInteraction()
    }
  }

  async function handleNextAction(intent: string) {
    if (!beginInteraction()) return
    setBusyIntent(intent)
    setError(null)
    try {
      switch (intent) {
        case 'send_intake':
          await sendIntake()
          return
        case 'fill_intake':
        case 'review_intake':
          setIntakeSheetOpen(true)
          return
        case 'import_intake':
          setImportIntakeOpen(true)
          return
        case 'quote_fee':
          openField('fee')
          return
        case 'draft_engagement':
          await action(`/api/admin/leads/${lead.id}/engagement-draft`)()
          return
        case 'call':
          openExternalPhone({ number: lead.phone ?? undefined })
          return
        case 'email':
          setCommunicationChannel('email')
          return
        case 'review_engagement':
          if (activeAgreement?.id) router.push(`/admin/engagements/${activeAgreement.id}`)
          else changeTab('documents')
          return
        case 'schedule_meeting':
          setBookForClientOpen(true)
          return
        case 'snooze':
          setSnoozeOpen(true)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed')
    } finally {
      setBusyIntent(null)
      endInteraction()
    }
  }

  async function handleTopDraft() {
    if (!beginInteraction()) return
    try {
      await action(`/api/admin/leads/${lead.id}/engagement-draft`)()
    } finally {
      endInteraction()
    }
  }

  function handleTopConvert() {
    if (!beginInteraction()) return
    if (lead.lead_status === 'hired' && lead.matter_id) {
      router.push(`/admin/matters/${lead.matter_id}`)
      endInteraction()
      return
    }
    void action(`/api/admin/leads/${lead.id}/convert`)().finally(endInteraction)
  }

  async function handleTopStatusChange(status: MutableLeadStatus) {
    if (!beginInteraction()) return
    try {
      await persistStatus(status)
    } finally {
      endInteraction()
    }
  }

  const [removeSpouseConfirmOpen, setRemoveSpouseConfirmOpen] = useState(false)

  function removeSpouse() {
    setSpouseRemovalError(null)
    setRemoveSpouseConfirmOpen(true)
  }

  function changeActiveField(field: LeadEditableField | null) {
    if (field !== 'spouse') setSpouseRemovalError(null)
    setActiveField(field)
  }

  const clientName = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Lead'
  const clientInitial = clientName.trim().charAt(0).toUpperCase() || '—'
  const statusLabel = lead.lead_status.charAt(0).toUpperCase() + lead.lead_status.slice(1)
  const leadDay = calendarDaysAgo(lead.created_at, firmTimezone) ?? 0
  const contacts = clientContactTimestamps(activity)
  const effectiveLastTouchAt = newestTimestamp([lastTouchAt, localTouchAt, contacts.lastClientContactAt])
  const effectiveLastResponseAt = newestTimestamp([lastClientResponseAt, contacts.lastClientResponseAt])
  const lastTouchDays = calendarDaysAgo(effectiveLastTouchAt, firmTimezone)
  const leadScore = computeLeadScore(initialScoreInput ?? leadScoreInputFromRow(lead))
  const engagementStatus = effectiveEngagementStatus(activeAgreement?.status, lead)
  const computedAction = computeNextAction({
    leadStatus: lead.lead_status,
    intakeSentAt: lead.intake_sent_at ?? null,
    intakeCompletedAt: lead.intake_completed_at ?? null,
    nextAppointmentAt,
    feeQuoted: lead.engagement_fee_quoted,
    hasActiveAgreement: Boolean(activeAgreement),
    engagementStatus: engagementStatus ?? undefined,
    engagementSentAt: lead.engagement_sent_at,
    engagementSignedAt: lead.engagement_signed_at,
    discoveryCallAt: keyDates?.discoveryCallAt,
    planningSessionAt: keyDates?.pmpsAt,
    lastTouchAt: effectiveLastTouchAt,
    timeZone: firmTimezone,
  })
  const availableAction: NextAction = computedAction.key === 'follow_up'
    ? {
        ...computedAction,
        actions: computedAction.actions.filter(item => {
          if (item.intent === 'call') return phoneTelHref(lead.phone) !== null
          if (item.intent === 'email') return Boolean(lead.email?.trim())
          return true
        }),
      }
    : computedAction
  const snoozedUntil = Date.parse(lead.lead_next_action_snoozed_until ?? '')
  const snoozed = Number.isFinite(snoozedUntil) && snoozedUntil > Date.now()
  const visibleAction = availableAction.key !== 'nothing'
    && availableAction.actions.length > 0
    && !snoozed
    ? availableAction
    : null
  const operationalBrief = leadOperationalBrief({
    lead,
    spouse,
    nextAction: availableAction,
    nextAppointmentAt,
    conflictCheck,
  })


  const timeline = (
    <LeadTimelineCard
      leadId={lead.id}
      leadPhone={lead.phone}
      initialNotes={notes}
      initialMeetingNotes={meetingNotes}
      initialActivity={activity}
      actorNames={actorNames}
      actorError={actorError}
      dataRefreshWarning={dataRefreshWarning}
      activityRefreshWarning={activityRefreshWarning}
      currentUser={currentUser}
      onActivityChange={async () => { await refreshActivity(); tasksChanged() }}
      onNotesChange={setNotes}
      onMeetingNotesChange={setMeetingNotes}
      addNoteRequest={noteRequest}
      onCommittedTouch={recordTouch}
      variant="plain"
    />
  )

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      {confirmDialog}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-4 py-3">
        <Link href="/admin/crm/opportunities" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Opportunities
        </Link>
        <span aria-hidden className="text-xs text-muted-foreground">/</span>
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-1.5">
          <span
            aria-hidden
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-muted text-micro font-semibold text-muted-foreground"
          >
            {clientInitial}
          </span>
          <h1 className="break-words text-base font-semibold">{clientName}</h1>
        </div>
        <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-micro font-medium text-muted-foreground lg:inline">
          {provisionalLeadNumber(lead)}
        </span>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-micro font-medium text-muted-foreground">
          {statusLabel} · day {leadDay}
        </span>
        <span className="text-xs text-muted-foreground">{leadProgressLabel(lead, engagementStatus)}</span>
        {effectiveLastTouchAt !== null && lastTouchDays !== null && (
          <span className="hidden shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-micro font-medium text-muted-foreground md:inline">
            Last contact {lastTouchDays}d ago
          </span>
        )}
        <div className="ml-auto shrink-0">
          <LeadTopActions
            busy={interactionBusy}
            status={lead.lead_status}
            hasActiveAgreement={Boolean(activeAgreement)}
            snoozed={snoozed}
            matterId={lead.matter_id}
            leadId={lead.id}
            onDraft={handleTopDraft}
            onConvert={handleTopConvert}
            onClearSnooze={() => void clearNextActionSnooze()}
            onStatusChange={handleTopStatusChange}
            onSendSchedulingLink={() => setSchedulingLinkOpen(true)}
            onBookForClient={() => setBookForClientOpen(true)}
            onCall={() => openExternalPhone({ number: lead.phone ?? undefined })}
            onEmail={() => setCommunicationChannel('email')}
            onText={() => setCommunicationChannel('sms')}
            onIntake={() => { setIntakeSection(null); setIntakeSheetOpen(true) }}
            onAddNote={addQuickNote}
            onPushToLawmatics={() => void pushToLawmatics()}
            pushingToLawmatics={pushingToLawmatics}
            onPushToStatular={() => void pushToStatular()}
            pushingToStatular={pushingToStatular}
            onToggleRail={() => { setRailOpen(current => !current); if (railOpen) setActiveField(null) }}
            railOpen={railOpen}
            hasEmail={Boolean(lead.email?.trim())}
            hasPhone={Boolean(lead.phone?.trim())}
          />
        </div>
      </header>

      {workSummary && <RecordWorkStrip summary={workSummary} />}

      {error && (
        <p role="alert" aria-live="polite" className="border-b border-border bg-card px-4 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <ResponsiveDetailRail
          open={railOpen}
          onOpenChange={open => { setRailOpen(open); if (!open) setActiveField(null) }}
          label="Lead details"
          desktopClassName={`${LEAD_DETAIL_RAIL_WIDTH} border-r border-border bg-card`}
          mobileClassName="bg-card"
        >
          <LeadFieldsRail
            lead={lead}
            spouse={spouse}
            onStageChange={handleTopStatusChange}
            stageBusy={interactionBusy}
            activeField={activeField}
            onActiveFieldChange={changeActiveField}
            onSaveField={saveField}
            onRemoveSpouse={removeSpouse}
            spouseRemovalError={spouseRemovalError}
          />
        </ResponsiveDetailRail>

        <main className="@container flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          {!workSummary && visibleAction && (
            <div className="mb-4">
              <LeadNextAction
                action={visibleAction}
                busy={interactionBusy}
                onIntent={intent => void handleNextAction(intent)}
              />
            </div>
          )}
          {snoozed && lead.lead_status === 'lead' && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted p-3 text-sm">
              <span>Next action snoozed until {leadDisplayDate(lead.lead_next_action_snoozed_until, firmTimezone)}</span>
              <Button variant="outline" size="sm" disabled={interactionBusy} onClick={() => void clearNextActionSnooze()}>Undo snooze</Button>
            </div>
          )}
          <Tabs value={activeTab} onValueChange={value => changeTab(value as LeadTab)}>
            {taskCounts.error && (
              <p role="status" className="text-sm text-destructive">
                {taskCounts.error}{' '}
                <button type="button" className="underline" onClick={() => void taskCounts.refresh()}>Retry</button>
              </p>
            )}
            <MobileRecordSectionSelect
              label="Lead section"
              value={activeTab}
              options={LEAD_SECTION_OPTIONS}
              onValueChange={changeTab}
            />
            <TabsList className="sticky top-0 z-10 hidden w-full justify-start overflow-x-auto bg-background py-2 md:flex">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="intake">Intake</TabsTrigger>
              <TabsTrigger value="tasks" className="gap-1.5">
                Tasks
                {taskCounts.overdue > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-micro tabular-nums">
                    {taskCounts.overdue}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="people">People</TabsTrigger>
              <TabsTrigger value="assets">Assets</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="communications">Messages</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <LeadOverview lead={lead} nextAppointmentAt={nextAppointmentAt}
                lastContactAt={effectiveLastTouchAt} lastResponseAt={effectiveLastResponseAt}
                updatedAt={newestTimestamp([recordUpdatedAt, lead.updated_at, ...activity.map(row => row.created_at), ...notes.map(note => note.updatedAt)])}
                agreementStatus={engagementStatus} timeZone={firmTimezone}
                // Sent by the app, the agreement's own status says so; this is for the ones that were not.
                engagementSentOutside={agreementSentInApp(activeAgreement?.status) ? undefined : Boolean(lead.engagement_sent_at || lead.engagement_signed_at)}
                onEngagementSentOutside={lead.matter_id && lead.lead_status === 'lead' ? markEngagementSentOutside : undefined}
                taskCount={taskCounts.open} tasksVersion={tasksVersion}
                onIntake={() => changeTab('intake')} onEngagement={() => changeTab('documents')}
                onTasks={() => changeTab('tasks')} onSchedule={() => setBookForClientOpen(true)} />
              <OperationalBrief brief={{
                known: operationalBrief.known,
                missing: operationalBrief.missing,
                clientFollowUp: operationalBrief.clientFollowUp,
                attorneyDecision: operationalBrief.attorneyDecision,
                conflicts: operationalBrief.conflicts,
                nextStageLabel: operationalBrief.nextStage,
                nextStageBlockers: operationalBrief.blockers.map(item => item.label),
                meetingPreparation: operationalBrief.meetingPreparation,
              }} />
              <LeadConflictCard
                leadId={lead.id}
                initialCheck={conflictCheck}
                canDecide={lead.lead_status === 'lead'}
                onChange={setConflictCheck}
              />
              <LeadScoreCard
                leadId={lead.id}
                score={leadScore}
                leadStatus={lead.lead_status}
                onFillField={openField}
                onIntent={intent => void handleNextAction(intent)}
                /*
                 * The banner above already owns the pipeline step. When it is
                 * telling the reader to quote the fee, the card must not say
                 * the same thing one panel lower.
                 */
                coveredByNextAction={visibleAction && availableAction.key === 'quote_fee' ? 'fee' : null}
              />

              {keyDates && (
                <LeadKeyDatesCard
                  keyDates={keyDates}
                  onSaveKeyDate={saveKeyDate}
                  saving={keyDatesSaving}
                />
              )}

              {timeline}
            </TabsContent>

            <TabsContent value="intake" className="space-y-4">
              <RecordTabHeader
                title="Intake"
                description="The client questionnaire: send it, track its sections, or fill it in yourself."
                actions={
                  <Button type="button" size="sm" variant="outline" onClick={() => setImportIntakeOpen(true)}>
                    Import intake
                  </Button>
                }
              />
              <LeadIntakeCard
                intake={lead}
                intakeUrl={intakeUrl}
                linkRevoked={intakeLinkRevoked}
                onOpen={() => { setIntakeSection(null); setIntakeSheetOpen(true) }}
                onOpenSection={section => { setIntakeSection(section); setIntakeSheetOpen(true) }}
                onCopy={() => void copyIntakeUrl()}
                onEmail={() => void sendIntake()}
                onText={() => {
                  setCommunicationInitialMessage(`Please complete your secure intake: ${intakeUrl}`)
                  setCommunicationChannel('sms')
                }}
                onRotate={() => void rotateIntakeUrl()}
                onRevoke={() => void revokeIntakeUrl()}
                onTrackChange={(track) => void changeIntakeTrack(track)}
                busy={sendingIntake || intakeLinkBusy}
              />
            </TabsContent>

            <TabsContent value="people" className="space-y-4">
              {peopleMatter && lead.matter_id ? (
                <MatterPeopleTabContent
                  matterId={lead.matter_id}
                  matter={peopleMatter}
                  initialContacts={initialPeopleContacts}
                  recordLabel="lead"
                />
              ) : (
                <>
                  <RecordTabHeader
                    title="People"
                    description="Household, fiduciary, and beneficiary roles for this lead."
                  />
                  <Card className="py-0">
                    <EmptyState
                      icon={Users}
                      title="People unavailable"
                      description="People are unavailable because this lead is not linked to an opportunity record."
                    />
                  </Card>
                </>
              )}
              <LeadChannelsCard lead={lead} spouse={spouse} onSaveChannels={saveChannels} />
            </TabsContent>

            <TabsContent value="tasks" className="space-y-4">
              <RecordTabHeader
                title="Tasks"
                description="Firm work on this lead, by due date or by stage."
                actions={lead.matter_id ? (
                  <ViewSwitch value={taskView} options={TASK_VIEW_OPTIONS} onChange={changeTaskView} label="Task view" />
                ) : null}
              />
              <RecordTasksTab
                recordId={lead.id}
                recordKind="lead"
                recordName={clientName}
                onTasksChanged={tasksChanged}
                // The dated plan lives on the `matters` row this opportunity
                // owns; without one there is nothing to show, so the Plan view
                // does not appear at all.
                planMatterId={lead.matter_id ?? null}
                view={taskView}
                onViewChange={changeTaskView}
                hideViewSwitch
              />
            </TabsContent>

            <TabsContent value="communications" className="space-y-4">
              <RecordCommunicationsCard
                title="Messages"
                record={{ type: 'lead', id: lead.id }}
                recipientName={clientName}
                recipientEmail={lead.email ?? null}
                recipientPhone={lead.phone ?? null}
                smsEnabled={smsEnabled}
                onClientContact={async () => { await refreshActivityBestEffort(); router.refresh() }}
              />
            </TabsContent>

            <TabsContent value="assets" className="space-y-4">
              <RecordTabHeader
                title="Assets"
                description="Household asset inventory. Changes sync automatically to the design sheet when a matter is linked."
              />
              <MatterAssetsTab
                matterId={lead.matter_id ?? undefined}
                intakeId={liveIntakeId}
                clientName={clientName}
                spouseName={spouse
                  ? [spouse.first_name, spouse.last_name].filter(Boolean).join(' ') || null
                  : null}
                maritalStatus={lead.marital_status}
                accessToken={token}
              />
            </TabsContent>

            <TabsContent value="documents" className="space-y-4">
              <RecordTabHeader
                title="Documents"
                description="The engagement agreement, client uploads, and shared files for this lead."
              />
              <LeadDocumentsTab
                documents={documents}
                folders={documentFolders}
                loading={documentsLoading}
                error={documentsError}
                agreementStatus={activeAgreement?.status}
                matterId={lead.matter_id ?? null}
                agreementId={activeAgreement?.id ?? null}
                clientName={clientName}
                onDocumentsChanged={reloadDocuments}
                esignDocumentsEnabled={esignDocumentsEnabled}
                signatureRequests={signatureRequests}
                defaultSigner={lead.email
                  ? { name: clientName ?? '', email: lead.email }
                  : null}
              />
            </TabsContent>

            <TabsContent value="notes" className="space-y-4">
              <LeadTimelineCard
                leadId={lead.id}
                leadPhone={lead.phone}
                initialNotes={notes}
                initialMeetingNotes={meetingNotes}
                initialActivity={activity}
                actorNames={actorNames}
                actorError={actorError}
                dataRefreshWarning={dataRefreshWarning}
                activityRefreshWarning={activityRefreshWarning}
                currentUser={currentUser}
                onActivityChange={async () => { await refreshActivity(); tasksChanged() }}
      onNotesChange={setNotes}
      onMeetingNotesChange={setMeetingNotes}
      addNoteRequest={noteRequest}
                onCommittedTouch={recordTouch}
                variant="plain"
                lockedFilter="notes"
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <LeadSnoozeDialog open={snoozeOpen} onOpenChange={setSnoozeOpen} onSnooze={async until => {
        if (!beginInteraction()) throw new Error('Wait for the current action to finish.')
        setBusyIntent('snooze')
        try { await snoozeNextAction(until) }
        finally { setBusyIntent(null); endInteraction() }
      }} />
      <ImportIntakeDialog
        open={importIntakeOpen}
        onOpenChange={setImportIntakeOpen}
        leadId={lead.id}
        accessToken={token}
        parseTextUrl={`/api/admin/leads/${lead.id}/parse-intake`}
        parseDocxUrl={`/api/admin/leads/${lead.id}/parse-intake-docx`}
        onParsed={(parsedIntakeId) => {
          setLiveIntakeId(parsedIntakeId)
          setImportIntakeOpen(false)
          setIntakeSheetOpen(true)
          router.refresh()
        }}
      />

      <SendSchedulingLinkDialog
        target={{ kind: 'lead', id: lead.id }}
        open={schedulingLinkOpen}
        onOpenChange={setSchedulingLinkOpen}
      />
      <BookCalendlyDialog
        target={{ kind: 'lead', id: lead.id }}
        open={bookForClientOpen}
        onOpenChange={setBookForClientOpen}
      />
      <CommunicationDialog
        open={communicationChannel !== null}
        channel={communicationChannel ?? 'email'}
        target={{ type: 'lead', id: lead.id }}
        recipientName={clientName}
        recipientEmail={lead.email ?? ''}
        recipientPhone={lead.phone ?? ''}
        templateCategories={['manual', 'intake_invite', 'intake_invite_college_prep']}
        variableValues={{
          client_name: clientName,
          client_first_name: lead.preferred_name?.trim() || lead.first_name?.trim() || clientName,
          first_name: lead.preferred_name?.trim() || lead.first_name?.trim() || clientName,
          lead_name: clientName,
          intake_link: intakeUrl,
          intakeUrl,
        }}
        initialMessage={communicationInitialMessage}
        token={token}
        onOpenChange={open => {
          if (!open) {
            setCommunicationChannel(null)
            setCommunicationInitialMessage(undefined)
          }
        }}
        onSent={async () => {
          toast.success(communicationChannel === 'sms' ? 'Text sent' : 'Email sent')
          await refreshActivityBestEffort()
          router.refresh()
        }}
      />

      {intakeSheetOpen && (
        <AdminIntakeSheet
          leadId={lead.id}
          clientIntakeId={liveIntakeId}
          clientUserId={lead.client_user_id ?? lead.user_id ?? null}
          practiceArea={practiceAreaLabel(lead.practice_area)}
          clientName={clientName}
          initialSection={intakeSection}
          open={intakeSheetOpen}
          onClose={() => setIntakeSheetOpen(false)}
          onIntakeIdChange={setLiveIntakeId}
          onSubmitted={() => {
            setIntakeSheetOpen(false)
            router.refresh()
          }}
        />
      )}

      <AlertDialog open={removeSpouseConfirmOpen} onOpenChange={setRemoveSpouseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this spouse?</AlertDialogTitle>
            <AlertDialogDescription>
              The spouse&apos;s details entered on this lead will no longer be shown.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRemoveSpouseConfirmOpen(false)
                void saveField('spouse', null)
                  .then(() => {
                    setSpouseRemovalError(null)
                    setActiveField(null)
                  })
                  .catch(caught => {
                    setSpouseRemovalError(caught instanceof Error ? caught.message : 'Could not remove spouse')
                  })
              }}
            >
              Remove spouse
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
