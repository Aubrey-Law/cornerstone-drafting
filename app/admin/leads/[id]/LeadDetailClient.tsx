'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { openStaffSoftphone } from '@/app/admin/components/softphoneEvents'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { phoneTelHref } from '@/lib/phone'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'
import type { LeadEditableField } from '@/lib/leads/details'
import { parseLeadTab, type LeadTab } from '@/lib/leads/leadPageTabs'
import { computeNextAction, type NextAction } from '@/lib/leads/nextAction'
import type {
  LeadTimelineCall,
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
import { RecordTasksTab } from '@/components/tasks/RecordTasksTab'
import { useRecordTaskCounts } from '@/components/tasks/useRecordTaskCounts'
import type { RecordTaskCounts } from '@/lib/tasks/types'
import {
  LeadFieldsRail,
  LEAD_DETAIL_RAIL_WIDTH,
} from '@/components/leads/LeadFieldsRail'
import { LeadNextAction } from '@/components/leads/LeadNextAction'
import { LeadPlanTab } from '@/components/leads/LeadPlanTab'
import { LeadDocumentsTab, useLeadDocuments } from '@/components/leads/LeadDocumentsTab'
import { LeadTopActions } from '@/components/leads/LeadTopActions'
import { provisionalLeadNumber } from '@/components/leads/LeadsTable'
import { LeadCommunicationDialog } from '@/components/leads/LeadCommunicationDialog'
import { RecordCommunicationsCard } from '@/components/comms/RecordCommunicationsCard'
import { LeadTimelineCard } from '@/components/leads/LeadTimelineCard'
import {
  isMobileDetailViewport,
  ResponsiveDetailRail,
} from '@/components/layout/ResponsiveDetailRail'
import { LeadIntakeCard } from './LeadIntakeCard'
import { SendSchedulingLinkDialog } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BookCalendlyDialog } from '@/components/scheduling/BookCalendlyDialog'
import type {
  LeadActivityViewRow,
  LeadDetailRecord,
  LeadSpouseRecord,
} from '@/lib/leads/viewTypes'
import type { MatterContact, PipelineMatter } from '@/types/database'
import { MatterPeopleTab } from '@/app/admin/matters/[id]/MatterPeopleTab'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('@/app/admin/matters/[id]/ImportIntakeDialog'), { ssr: false })
const MatterAssetsTab = dynamic(
  () => import('@/app/admin/matters/[id]/tabs/assets').then(module => ({ default: module.MatterAssetsTab })),
  { ssr: false, loading: () => <p className="text-xs text-muted-foreground">Loading assets…</p> },
)

type LeadRecord = LeadDetailRecord
type LeadSpouse = LeadSpouseRecord
type LeadActivityRow = LeadActivityViewRow

type LeadDetailClientProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  initialActivity: LeadActivityRow[]
  initialNotes?: LeadTimelineNote[]
  initialMeetingNotes?: LeadTimelineMeeting[]
  initialCalls?: LeadTimelineCall[]
  actorNames?: Record<string, string>
  firmTimezone?: string
  nextAppointmentAt?: string | null
  lastTouchAt?: string | null
  callsError?: string | null
  actorError?: string | null
  currentUser?: { id: string; role: string }
  activeAgreement?: { id: string } | null
  peopleMatter?: PipelineMatter | null
  initialPeopleContacts?: MatterContact[]
  initialTaskCounts?: RecordTaskCounts
  initialIntakeUrl?: string | null
  smsEnabled?: boolean
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

const DAY_MS = 86_400_000

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
  initialNotes = [],
  initialMeetingNotes = [],
  initialCalls = [],
  actorNames = {},
  firmTimezone = FIRM_TIMEZONE,
  nextAppointmentAt = null,
  lastTouchAt,
  callsError = null,
  actorError = null,
  currentUser = { id: '', role: '' },
  activeAgreement = null,
  peopleMatter = null,
  initialPeopleContacts = [],
  initialTaskCounts = { open: 0, overdue: 0 },
  initialIntakeUrl = null,
  smsEnabled = true,
}: LeadDetailClientProps) {
  const token = useAccessToken()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [lead, setLead] = useState(initialLead)
  const [spouse, setSpouse] = useState(initialSpouse)
  const [activeField, setActiveField] = useState<LeadEditableField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState(initialActivity)
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
  const [sendingIntake, setSendingIntake] = useState(false)
  const [intakeLinkBusy, setIntakeLinkBusy] = useState(false)
  const [communicationInitialMessage, setCommunicationInitialMessage] = useState<string | undefined>()

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
    loading: documentsLoading,
    reload: reloadDocuments,
  } = useLeadDocuments(lead.matter_id)
  const taskCounts = useRecordTaskCounts(lead.id, initialTaskCounts)

  // The URL owns the tab, but the click applies immediately so the workspace
  // never waits on a router round trip.
  const urlTab = parseLeadTab(searchParams?.get('tab'))
  const [activeTab, setActiveTab] = useState<LeadTab>(urlTab)
  useEffect(() => { setActiveTab(urlTab) }, [urlTab])

  function changeTab(tab: LeadTab) {
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (tab === 'plan') params.delete('tab')
    else params.set('tab', tab)
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

  async function refreshActivity() {
    const json = await call<{ activity?: LeadActivityRow[] }>(`/api/admin/leads/${lead.id}/activity`, undefined, 'GET')
    setActivity(Array.isArray(json.activity) ? json.activity : [])
    setActivityRefreshWarning(null)
  }

  async function refreshActivityBestEffort() {
    try {
      await refreshActivity()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not refresh timeline'
      setActivityRefreshWarning(message)
    }
  }

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
      recordTouch(json.activity.created_at)
    } else {
      recordTouch(null)
    }
    setDataRefreshWarning(json.refreshWarning ?? null)
  }

  async function sendIntake() {
    setSendingIntake(true)
    setError(null)
    try {
      const json = await call<{ url?: string }>('/api/admin/intake/send', { intakeId: lead.id })
      if (typeof json.url === 'string') setIntakeUrl(json.url)
      setLead(current => ({
        ...current,
        intake_sent_at: new Date().toISOString(),
        intake_status: current.intake_status === 'completed' ? current.intake_status : 'sent',
      }))
      recordTouch(null)
      await refreshActivityBestEffort()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send intake')
    } finally {
      setSendingIntake(false)
    }
  }

  async function copyIntakeUrl() {
    if (!intakeUrl) return
    try {
      await navigator.clipboard.writeText(intakeUrl)
      setError(null)
    } catch {
      setError('Could not copy intake link')
    }
  }

  async function rotateIntakeUrl() {
    if (!window.confirm('Replace this intake link? The previous link will stop working immediately.')) return
    setIntakeLinkBusy(true)
    try {
      const json = await call<{ url: string }>('/api/admin/intake/link', { intakeId: lead.id })
      setIntakeUrl(json.url)
      toast.success('Intake link replaced')
      await refreshActivityBestEffort()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not replace intake link')
    } finally {
      setIntakeLinkBusy(false)
    }
  }

  async function revokeIntakeUrl() {
    if (!window.confirm('Revoke this intake link? It will stop working until a new link is prepared.')) return
    setIntakeLinkBusy(true)
    try {
      await call('/api/admin/intake/link', { intakeId: lead.id }, 'DELETE')
      setIntakeUrl(null)
      toast.success('Intake link revoked')
      await refreshActivityBestEffort()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke intake link')
    } finally {
      setIntakeLinkBusy(false)
    }
  }

  async function persistStatus(status: 'lead' | 'lost') {
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
    recordTouch(json.activity.created_at)
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
          setActiveField('fee')
          return
        case 'draft_engagement':
          await action(`/api/admin/leads/${lead.id}/engagement-draft`)()
          return
        case 'call':
          openStaffSoftphone({ number: lead.phone ?? undefined })
          return
        case 'email':
          setCommunicationChannel('email')
          return
        case 'snooze':
          await snoozeNextAction(new Date(Date.now() + 7 * DAY_MS).toISOString())
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

  async function handleTopStatusChange(status: 'lead' | 'lost') {
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
  const effectiveLastTouchAt = newestTimestamp([
    lastTouchAt,
    localTouchAt,
    ...activity.map(row => row.created_at),
    ...initialNotes.map(note => note.createdAt),
    ...initialMeetingNotes.map(note => note.createdAt),
    ...initialCalls.map(call => call.started_at),
  ])
  const lastTouchDays = calendarDaysAgo(effectiveLastTouchAt, firmTimezone)
  const lastMeetingAt = newestTimestamp(initialMeetingNotes.map(note => note.date || note.createdAt))
  const computedAction = computeNextAction({
    leadStatus: lead.lead_status,
    intakeSentAt: lead.intake_sent_at ?? null,
    intakeCompletedAt: lead.intake_completed_at ?? null,
    nextAppointmentAt,
    feeQuoted: lead.engagement_fee_quoted,
    hasActiveAgreement: Boolean(activeAgreement),
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

  const timelineCount = activity.length
    + initialNotes.length
    + initialMeetingNotes.length
    + initialCalls.length
  const documentsCount = documents.length + (activeAgreement ? 1 : 0)

  const timeline = (
    <LeadTimelineCard
      leadId={lead.id}
      leadPhone={lead.phone}
      initialNotes={initialNotes}
      initialMeetingNotes={initialMeetingNotes}
      initialCalls={initialCalls}
      initialActivity={activity}
      actorNames={actorNames}
      callsError={callsError}
      actorError={actorError}
      dataRefreshWarning={dataRefreshWarning}
      activityRefreshWarning={activityRefreshWarning}
      currentUser={currentUser}
      onActivityChange={refreshActivity}
      onCommittedTouch={recordTouch}
      variant="plain"
    />
  )

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
        <Link href="/admin/leads" className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Leads
        </Link>
        <span aria-hidden className="text-xs text-muted-foreground">/</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-muted text-[10px] font-semibold text-muted-foreground"
          >
            {clientInitial}
          </span>
          <span className="truncate text-sm font-semibold">{clientName}</span>
        </span>
        <span className="hidden shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground lg:inline">
          {provisionalLeadNumber(lead)}
        </span>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {statusLabel} · day {leadDay}
        </span>
        {effectiveLastTouchAt !== null && lastTouchDays !== null && (
          <span className="hidden shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground md:inline">
            Last touch {lastTouchDays}d ago
          </span>
        )}
        <div className="ml-auto shrink-0">
          <LeadTopActions
            busy={interactionBusy}
            status={lead.lead_status}
            hasActiveAgreement={Boolean(activeAgreement)}
            snoozed={snoozed}
            matterId={lead.matter_id}
            onDraft={handleTopDraft}
            onConvert={handleTopConvert}
            onClearSnooze={() => void clearNextActionSnooze()}
            onStatusChange={handleTopStatusChange}
            onSendSchedulingLink={() => setSchedulingLinkOpen(true)}
            onBookForClient={() => setBookForClientOpen(true)}
            onCall={() => openStaffSoftphone({ number: lead.phone ?? undefined })}
            onEmail={() => setCommunicationChannel('email')}
            onText={() => setCommunicationChannel('sms')}
            onIntake={() => setIntakeSheetOpen(true)}
            onToggleRail={() => setRailOpen(current => !current)}
            railOpen={railOpen}
            hasEmail={Boolean(lead.email?.trim())}
            hasPhone={Boolean(lead.phone?.trim())}
          />
        </div>
      </header>

      {error && (
        <p role="alert" aria-live="polite" className="border-b border-border bg-card px-4 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <ResponsiveDetailRail
          open={railOpen}
          onOpenChange={setRailOpen}
          label="Lead details"
          desktopClassName={`${LEAD_DETAIL_RAIL_WIDTH} border-r border-border bg-card`}
          mobileClassName="bg-card"
        >
          <LeadFieldsRail
            lead={lead}
            spouse={spouse}
            activeField={activeField}
            onActiveFieldChange={changeActiveField}
            onSaveField={saveField}
            onRemoveSpouse={removeSpouse}
            spouseRemovalError={spouseRemovalError}
          />
        </ResponsiveDetailRail>

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          {visibleAction && (
            <div className="mb-4">
              <LeadNextAction
                action={visibleAction}
                busy={interactionBusy}
                onIntent={intent => void handleNextAction(intent)}
              />
            </div>
          )}

          <Tabs value={activeTab} onValueChange={value => changeTab(value as LeadTab)}>
            <TabsList className="w-full justify-start overflow-x-auto bg-background">
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="tasks" className="gap-1.5">
                Tasks
                {taskCounts.overdue > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] tabular-nums">
                    {taskCounts.overdue}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="timeline">Timeline ({timelineCount})</TabsTrigger>
              <TabsTrigger value="communications">Comms</TabsTrigger>
              <TabsTrigger value="intake">Intake</TabsTrigger>
              <TabsTrigger value="people">People</TabsTrigger>
              <TabsTrigger value="assets">Assets</TabsTrigger>
              <TabsTrigger value="documents">Documents ({documentsCount})</TabsTrigger>
              <TabsTrigger value="notes">Notes ({initialNotes.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="plan" className="mt-4">
              <LeadPlanTab
                lead={lead}
                spouse={spouse}
                nextAppointmentAt={nextAppointmentAt}
                lastMeetingAt={lastMeetingAt}
                hasActiveAgreement={Boolean(activeAgreement)}
                agreementId={activeAgreement?.id ?? null}
                busy={interactionBusy}
                onDraft={handleTopDraft}
                onPreviewAgreement={() => {
                  if (activeAgreement) router.push(`/admin/engagements/${activeAgreement.id}?step=design`)
                }}
                onOpenField={field => {
                  if (!railOpen) setRailOpen(true)
                  changeActiveField(field)
                }}
                onOpenIntake={() => setIntakeSheetOpen(true)}
              />
            </TabsContent>

            <TabsContent value="tasks" className="mt-4">
              <RecordTasksTab
                recordId={lead.id}
                recordKind="lead"
                recordName={clientName}
                onTasksChanged={() => void taskCounts.refresh()}
              />
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              {timeline}
            </TabsContent>

            <TabsContent value="communications" className="mt-4">
              <RecordCommunicationsCard
                record={{ type: 'lead', id: lead.id }}
                recipientName={clientName}
                recipientEmail={lead.email ?? null}
                recipientPhone={lead.phone ?? null}
                smsEnabled={smsEnabled}
              />
            </TabsContent>

            <TabsContent value="intake" className="mt-4">
              <LeadIntakeCard
                intake={lead}
                intakeUrl={intakeUrl}
                onOpen={() => setIntakeSheetOpen(true)}
                onCopy={() => void copyIntakeUrl()}
                onEmail={() => void sendIntake()}
                onText={() => {
                  setCommunicationInitialMessage(`Please complete your secure intake: ${intakeUrl}`)
                  setCommunicationChannel('sms')
                }}
                onRotate={() => void rotateIntakeUrl()}
                onRevoke={() => void revokeIntakeUrl()}
                busy={sendingIntake || intakeLinkBusy}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setImportIntakeOpen(true)}>
                  Import intake — paste text or upload Word
                </Button>
              </div>
            </TabsContent>

            {peopleMatter && lead.matter_id ? (
              <MatterPeopleTab
                matterId={lead.matter_id}
                matter={peopleMatter}
                initialContacts={initialPeopleContacts}
                recordLabel="lead"
              />
            ) : (
              <TabsContent value="people" className="mt-4">
                <p className="py-6 text-center text-sm text-muted-foreground">
                  People are unavailable because this lead is not linked to an opportunity record.
                </p>
              </TabsContent>
            )}

            <TabsContent value="assets" className="mt-4">
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

            <TabsContent value="documents" className="mt-4">
              <LeadDocumentsTab
                documents={documents}
                loading={documentsLoading}
                matterId={lead.matter_id ?? null}
                agreementId={activeAgreement?.id ?? null}
                clientName={clientName}
                onDocumentsChanged={reloadDocuments}
              />
            </TabsContent>

            <TabsContent value="notes" className="mt-4">
              <LeadTimelineCard
                leadId={lead.id}
                leadPhone={lead.phone}
                initialNotes={initialNotes}
                initialMeetingNotes={initialMeetingNotes}
                initialCalls={initialCalls}
                initialActivity={activity}
                actorNames={actorNames}
                callsError={callsError}
                actorError={actorError}
                dataRefreshWarning={dataRefreshWarning}
                activityRefreshWarning={activityRefreshWarning}
                currentUser={currentUser}
                onActivityChange={refreshActivity}
                onCommittedTouch={recordTouch}
                variant="plain"
                lockedFilter="notes"
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>

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
      <LeadCommunicationDialog
        open={communicationChannel !== null}
        channel={communicationChannel ?? 'email'}
        leadId={lead.id}
        clientName={clientName}
        clientFirstName={lead.preferred_name?.trim() || lead.first_name?.trim() || clientName}
        email={lead.email ?? ''}
        phone={lead.phone ?? ''}
        intakeUrl={intakeUrl}
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
          recordTouch(new Date().toISOString())
          await refreshActivityBestEffort()
        }}
      />

      {intakeSheetOpen && (
        <AdminIntakeSheet
          leadId={lead.id}
          clientIntakeId={liveIntakeId}
          clientUserId={lead.client_user_id ?? lead.user_id ?? null}
          practiceArea={practiceAreaLabel(lead.practice_area)}
          clientName={clientName}
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
