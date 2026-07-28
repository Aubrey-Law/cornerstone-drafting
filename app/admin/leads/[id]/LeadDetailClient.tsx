'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { OPEN_STAFF_SOFTPHONE_EVENT } from '@/app/admin/components/StaffSoftphone'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { formatPhoneDisplay, phoneTelHref } from '@/lib/phone'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'
import type { LeadEditableField } from '@/lib/leads/details'
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
import { LeadDetailsCard } from '@/components/leads/LeadDetailsCard'
import { LeadNextAction } from '@/components/leads/LeadNextAction'
import { LeadTopActions } from '@/components/leads/LeadTopActions'
import { LeadCommunicationDialog } from '@/components/leads/LeadCommunicationDialog'
import { LeadTimelineCard } from '@/components/leads/LeadTimelineCard'
import { LeadIntakeCard } from './LeadIntakeCard'
import { SendSchedulingLinkDialog } from '@/components/scheduling/SendSchedulingLinkDialog'
import { BookCalendlyDialog } from '@/components/scheduling/BookCalendlyDialog'
import type {
  LeadActivityViewRow,
  LeadDetailRecord,
  LeadSpouseRecord,
} from '@/lib/leads/viewTypes'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('@/app/admin/matters/[id]/ImportIntakeDialog'), { ssr: false })

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
}: LeadDetailClientProps) {
  const token = useAccessToken()
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [spouse, setSpouse] = useState(initialSpouse)
  const [activeField, setActiveField] = useState<LeadEditableField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState(initialActivity)
  const [busy, setBusy] = useState(false)
  const [busyIntent, setBusyIntent] = useState<string | null>(null)
  const [intakeSheetOpen, setIntakeSheetOpen] = useState(false)
  const [importIntakeOpen, setImportIntakeOpen] = useState(false)
  const [schedulingLinkOpen, setSchedulingLinkOpen] = useState(false)
  const [bookForClientOpen, setBookForClientOpen] = useState(false)
  const [communicationChannel, setCommunicationChannel] = useState<'email' | 'sms' | null>(null)
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialLead.id)
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null)
  const [sendingIntake, setSendingIntake] = useState(false)
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
          window.dispatchEvent(new Event(OPEN_STAFF_SOFTPHONE_EVENT))
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
  const subtitle = [
    practiceAreaLabel(lead.practice_area),
    lead.lead_source,
    formatPhoneDisplay(lead.phone),
    lead.email?.trim(),
  ].filter(Boolean).join(' · ')
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

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <header className="border-b border-border bg-card px-4 py-4 md:px-6">
        <div className="mb-3">
          <Link href="/admin/leads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Leads
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[21px] font-semibold tracking-tight">{clientName}</h1>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {statusLabel} · day {leadDay}
              </span>
              {effectiveLastTouchAt !== null && lastTouchDays !== null && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Last touch {lastTouchDays}d ago
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle || 'Prospective client'}</p>
          </div>
          <LeadTopActions
            busy={interactionBusy}
            status={lead.lead_status}
            hasActiveAgreement={Boolean(activeAgreement)}
            snoozed={snoozed}
            matterId={lead.matter_id}
            actionError={error}
            onDraft={handleTopDraft}
            onConvert={handleTopConvert}
            onClearSnooze={() => void clearNextActionSnooze()}
            onStatusChange={handleTopStatusChange}
            onSendSchedulingLink={() => setSchedulingLinkOpen(true)}
            onBookForClient={() => setBookForClientOpen(true)}
            onEmail={() => setCommunicationChannel('email')}
            onText={() => setCommunicationChannel('sms')}
            hasEmail={Boolean(lead.email?.trim())}
            hasPhone={Boolean(lead.phone?.trim())}
          />
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-4">
        <div className="space-y-4">
          {visibleAction && (
            <LeadNextAction
              action={visibleAction}
              busy={interactionBusy}
              onIntent={intent => void handleNextAction(intent)}
            />
          )}
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4">
              <LeadDetailsCard
                lead={lead}
                spouse={spouse}
                activeField={activeField}
                onActiveFieldChange={changeActiveField}
                onSaveField={saveField}
                onRemoveSpouse={removeSpouse}
                spouseRemovalError={spouseRemovalError}
              />
              <LeadIntakeCard
                intake={lead}
                intakeUrl={intakeUrl}
                onOpen={() => setIntakeSheetOpen(true)}
                onCopy={() => void copyIntakeUrl()}
              />
            </div>
            <div className="xl:sticky xl:top-4">
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
              />
            </div>
          </div>
        </div>
      </main>

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
        token={token}
        onOpenChange={open => {
          if (!open) setCommunicationChannel(null)
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
