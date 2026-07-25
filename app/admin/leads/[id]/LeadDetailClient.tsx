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
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import type { LeadEditableField } from '@/lib/leads/details'
import { computeNextAction, type NextAction } from '@/lib/leads/nextAction'
import type {
  LeadTimelineCall,
  LeadTimelineMeeting,
  LeadTimelineNote,
} from '@/lib/leads/timeline'
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
import { LeadTimelineCard } from '@/components/leads/LeadTimelineCard'
import { LeadIntakeCard } from './LeadIntakeCard'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('@/app/admin/matters/[id]/ImportIntakeDialog'), { ssr: false })

type LeadRecord = {
  [key: string]: unknown
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  preferred_name: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  marital_status: string | null
  practice_area: string | null
  lead_source: string | null
  lead_status: string
  engagement_fee_quoted: number | null
  lead_urgency?: string | null
  taxable_estate?: number | null
  has_minor_children?: boolean | null
  qualification_notes?: string | null
  created_at?: string | null
  updated_at?: string | null
  intake_sent_at?: string | null
  intake_completed_at?: string | null
  intake_status?: string | null
  lead_next_action_snoozed_until?: string | null
  user_id?: string | null
  client_user_id?: string | null
  matter_id?: string | null
}

type LeadSpouse = {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
}

type LeadActivityRow = {
  id: string
  event_type?: string | null
  title: string
  detail?: string | null
  actor_id?: string | null
  created_at: string
}

type LeadDetailClientProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  initialActivity: LeadActivityRow[]
  initialNotes?: LeadTimelineNote[]
  initialMeetingNotes?: LeadTimelineMeeting[]
  initialCalls?: LeadTimelineCall[]
  actorNames?: Record<string, string>
  nextAppointmentAt?: string | null
  lastTouchAt?: string | null
  currentUser?: { id: string; role: string }
  activeAgreement?: { id: string } | null
}

type LeadPatchResponse = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  matterId?: string
}

type SnoozeResponse = {
  lead: LeadRecord
  activity: LeadActivityRow
}

const DAY_MS = 86_400_000

function calendarDaysAgo(value: string | null | undefined): number | null {
  if (!value) return null
  const then = new Date(value)
  if (!Number.isFinite(then.getTime())) return null
  const now = new Date(Date.now())
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const thenDay = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())
  return Math.max(0, Math.round((nowDay - thenDay) / DAY_MS))
}

export function LeadDetailClient({
  lead: initialLead,
  spouse: initialSpouse,
  initialActivity,
  initialNotes = [],
  initialMeetingNotes = [],
  initialCalls = [],
  actorNames = {},
  nextAppointmentAt = null,
  lastTouchAt,
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
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialLead.id)
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null)
  const [sendingIntake, setSendingIntake] = useState(false)
  const [spouseRemovalError, setSpouseRemovalError] = useState<string | null>(null)
  const initialLeadRef = useRef(initialLead)

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
      await refreshActivity()
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

  function statusPayload(status: string) {
    return {
      firstName: lead.first_name ?? '',
      middleName: lead.middle_name ?? '',
      lastName: lead.last_name ?? '',
      preferredName: lead.preferred_name ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      dateOfBirth: lead.date_of_birth ?? '',
      addressLine1: lead.address_line1 ?? '',
      addressLine2: lead.address_line2 ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
      zip: lead.zip ?? '',
      county: lead.county ?? '',
      maritalStatus: lead.marital_status ?? '',
      practiceArea: normalizePracticeArea(lead.practice_area),
      source: lead.lead_source ?? '',
      status,
      fee: lead.engagement_fee_quoted,
      urgency: lead.lead_urgency ?? null,
      estimatedEstateValue: lead.taxable_estate ?? null,
      hasMinorChildren: lead.has_minor_children ?? null,
      qualificationNotes: lead.qualification_notes ?? '',
      spouse: spouse ? {
        firstName: spouse.first_name ?? '',
        middleName: spouse.middle_name ?? '',
        lastName: spouse.last_name ?? '',
        preferredName: spouse.preferred_name ?? '',
        email: spouse.email ?? '',
        phone: spouse.phone ?? '',
        dateOfBirth: spouse.date_of_birth ?? '',
      } : null,
    }
  }

  async function persistStatus(status: string) {
    setError(null)
    setBusy(true)
    try {
      const json = await call<LeadPatchResponse>(
        `/api/admin/leads/${lead.id}`,
        statusPayload(status),
        'PATCH',
      )
      setLead(json.lead)
      setSpouse(json.spouse)
      await refreshActivity()
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
      setLead(json.lead)
      setSpouse(json.spouse)
      await refreshActivity()
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

  async function snoozeNextAction(nextActionSnoozedUntil: string) {
    const json = await call<SnoozeResponse>(
      `/api/admin/leads/${lead.id}`,
      { nextActionSnoozedUntil },
      'PATCH',
    )
    setLead(json.lead)
    setActivity(current => [
      json.activity,
      ...current.filter(row => row.id !== json.activity.id),
    ])
  }

  async function handleNextAction(intent: string) {
    if (busyIntent) return
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
          window.location.assign(`mailto:${lead.email ?? ''}`)
          return
        case 'snooze':
          await snoozeNextAction(new Date(Date.now() + 7 * DAY_MS).toISOString())
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed')
    } finally {
      setBusyIntent(null)
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
  const leadDay = calendarDaysAgo(lead.created_at) ?? 0
  const lastTouchDays = calendarDaysAgo(lastTouchAt)
  const computedAction = computeNextAction({
    leadStatus: lead.lead_status,
    intakeSentAt: lead.intake_sent_at ?? null,
    intakeCompletedAt: lead.intake_completed_at ?? null,
    nextAppointmentAt,
    feeQuoted: lead.engagement_fee_quoted,
    hasActiveAgreement: Boolean(activeAgreement),
    lastTouchAt: lastTouchAt ?? null,
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
  const visibleAction = availableAction.key !== 'nothing'
    && availableAction.actions.length > 0
    && !(Number.isFinite(snoozedUntil) && snoozedUntil > Date.now())
    ? availableAction
    : null

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
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
              {lastTouchAt !== undefined && lastTouchDays !== null && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Last touch {lastTouchDays}d ago
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle || 'Prospective client'}</p>
          </div>
          <LeadTopActions
            busy={busy || sendingIntake || activeField !== null}
            status={lead.lead_status}
            hasActiveAgreement={Boolean(activeAgreement)}
            matterId={lead.matter_id}
            actionError={error}
            onDraft={action(`/api/admin/leads/${lead.id}/engagement-draft`)}
            onConvert={lead.lead_status === 'hired' && lead.matter_id ? () => router.push(`/admin/matters/${lead.matter_id}`) : action(`/api/admin/leads/${lead.id}/convert`)}
            onStatusChange={status => void persistStatus(status)}
          />
        </div>
      </header>

      <main className="flex-1 overflow-auto px-6 py-4">
        <div className="space-y-4">
          {visibleAction && (
            <LeadNextAction
              action={visibleAction}
              busyIntent={busyIntent}
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
                currentUser={currentUser}
                onActivityChange={refreshActivity}
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
