'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { LeadDetailsCard, type LeadForm } from '@/components/leads/LeadDetailsCard'
import { LeadTopActions } from '@/components/leads/LeadTopActions'
import { LeadNotesCard, type LeadMeetingNote, type LeadNote } from '@/components/leads/LeadNotesCard'
import { LeadActivityCard } from '@/components/leads/LeadActivityCard'
import { CallList } from '@/components/calls/CallList'

type LeadRecord = {
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
  intake_sent_at?: string | null
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
  created_at: string
}

type LeadDetailClientProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  initialActivity: LeadActivityRow[]
  initialNotes?: LeadNote[]
  initialMeetingNotes?: LeadMeetingNote[]
  currentUser?: { id: string; role: string }
  activeAgreement?: { id: string } | null
}

function snapshot(lead: LeadRecord, spouse: LeadSpouse | null): LeadForm {
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
    status: lead.lead_status ?? 'lead',
    fee: lead.engagement_fee_quoted == null ? '' : String(lead.engagement_fee_quoted),
    urgency: lead.lead_urgency ?? '',
    estimatedEstateValue: lead.taxable_estate == null ? '' : String(lead.taxable_estate),
    minorChildren: lead.has_minor_children == null ? '' : lead.has_minor_children ? 'yes' : 'no',
    qualificationNotes: lead.qualification_notes ?? '',
    spousePresent: spouse ? 'yes' : 'no',
    spouseFirstName: spouse?.first_name ?? '',
    spouseMiddleName: spouse?.middle_name ?? '',
    spouseLastName: spouse?.last_name ?? '',
    spousePreferredName: spouse?.preferred_name ?? '',
    spouseEmail: spouse?.email ?? '',
    spousePhone: spouse?.phone ?? '',
    spouseDateOfBirth: spouse?.date_of_birth ?? '',
  }
}

export function LeadDetailClient({
  lead: initialLead,
  spouse: initialSpouse,
  initialActivity,
  initialNotes = [],
  initialMeetingNotes = [],
  currentUser = { id: '', role: '' },
  activeAgreement = null,
}: LeadDetailClientProps) {
  const token = useAccessToken()
  const router = useRouter()
  const [lead, setLead] = useState(initialLead)
  const [spouse, setSpouse] = useState(initialSpouse)
  const [form, setForm] = useState(() => snapshot(initialLead, initialSpouse))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState(initialActivity)
  const [busy, setBusy] = useState(false)

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

  function cancel() {
    setForm(snapshot(lead, spouse))
    setError(null)
    setFieldErrors({})
    setEditing(false)
  }

  function payload(status = form.status) {
    return {
      firstName: form.firstName,
      middleName: form.middleName,
      lastName: form.lastName,
      preferredName: form.preferredName,
      email: form.email,
      phone: form.phone,
      dateOfBirth: form.dateOfBirth,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2,
      city: form.city,
      state: form.state,
      zip: form.zip,
      county: form.county,
      maritalStatus: form.maritalStatus,
      practiceArea: form.practiceArea,
      source: form.source,
      status,
      fee: form.fee === '' ? null : Number(form.fee),
      urgency: form.urgency || null,
      estimatedEstateValue: form.estimatedEstateValue === '' ? null : Number(form.estimatedEstateValue),
      hasMinorChildren: form.minorChildren === '' ? null : form.minorChildren === 'yes',
      qualificationNotes: form.qualificationNotes,
      spouse: form.spousePresent === 'yes' ? {
        firstName: form.spouseFirstName,
        middleName: form.spouseMiddleName,
        lastName: form.spouseLastName,
        preferredName: form.spousePreferredName,
        email: form.spouseEmail,
        phone: form.spousePhone,
        dateOfBirth: form.spouseDateOfBirth,
      } : null,
    }
  }

  async function persist(status = form.status, close = true) {
    setError(null)
    setFieldErrors({})
    setBusy(true)
    try {
      const json = await call<{ lead: LeadRecord; spouse: LeadSpouse | null; matterId?: string }>(
        `/api/admin/leads/${lead.id}`,
        payload(status),
        'PATCH',
      )
      setLead(json.lead)
      setSpouse(json.spouse)
      setForm(snapshot(json.lead, json.spouse))
      if (close) setEditing(false)
      await refreshActivity()
      if (json.matterId) router.push(`/admin/matters/${json.matterId}`)
    } catch (caught) {
      const detail = caught as Error & { fieldErrors?: Record<string, string> }
      setError(detail.message || 'Could not save')
      setFieldErrors(detail.fieldErrors || {})
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const errors: Record<string, string> = {}
    if (!form.firstName.trim()) errors.firstName = 'First name is required'
    if (!form.lastName.trim()) errors.lastName = 'Last name is required'
    if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Invalid email'
    if (form.spousePresent === 'yes' && !form.spouseFirstName.trim()) errors.spouseFirstName = 'Spouse first name is required'
    if (form.spousePresent === 'yes' && !form.spouseLastName.trim()) errors.spouseLastName = 'Spouse last name is required'
    if (form.spousePresent === 'yes' && form.spouseEmail && !/^\S+@\S+\.\S+$/.test(form.spouseEmail)) errors.spouseEmail = 'Invalid spouse email'
    if (form.fee !== '' && (!Number.isFinite(Number(form.fee)) || Number(form.fee) < 0)) errors.fee = 'Invalid fee'
    if (form.estimatedEstateValue !== '' && (!Number.isFinite(Number(form.estimatedEstateValue)) || Number(form.estimatedEstateValue) < 0)) errors.estimatedEstateValue = 'Invalid estate value'
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError(Object.values(errors)[0])
      return
    }
    await persist()
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

  function removeSpouse() {
    const populated = ['spouseFirstName', 'spouseMiddleName', 'spouseLastName', 'spousePreferredName', 'spouseEmail', 'spousePhone', 'spouseDateOfBirth']
      .some(key => form[key].trim())
    if (!populated || window.confirm('Remove this spouse?')) {
      setForm(current => ({ ...current, spousePresent: 'no' }))
    }
  }

  const clientName = lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email || 'Lead'
  const subtitle = [practiceAreaLabel(lead.practice_area), lead.lead_source, lead.email].filter(Boolean).join(' · ')

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
            <h1 className="truncate text-xl font-semibold tracking-tight">{clientName}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle || 'Prospective client'}</p>
          </div>
          <LeadTopActions
            busy={busy}
            intakeSent={Boolean(lead.intake_sent_at)}
            status={lead.lead_status}
            hasActiveAgreement={Boolean(activeAgreement)}
            matterId={lead.matter_id}
            actionError={editing ? null : error}
            onIntake={action('/api/admin/intake/send', { intakeId: lead.id })}
            onDraft={action(`/api/admin/leads/${lead.id}/engagement-draft`)}
            onConvert={lead.lead_status === 'hired' && lead.matter_id ? () => router.push(`/admin/matters/${lead.matter_id}`) : action(`/api/admin/leads/${lead.id}/convert`)}
            onStatusChange={status => void persist(status, false)}
          />
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 py-4 md:px-6">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          <LeadDetailsCard
            lead={lead}
            spouse={spouse}
            editing={editing}
            form={form}
            error={error}
            fieldErrors={fieldErrors}
            busy={busy}
            onEdit={() => setEditing(true)}
            onCancel={cancel}
            onSave={save}
            onChange={(key, value) => {
              setForm(current => ({ ...current, [key]: value }))
              setFieldErrors(current => {
                const next = { ...current }
                delete next[key]
                return next
              })
            }}
            onRemoveSpouse={removeSpouse}
          />
          <LeadNotesCard
            leadId={lead.id}
            initialNotes={initialNotes}
            initialMeetingNotes={initialMeetingNotes}
            currentUser={currentUser}
            onActivityChange={refreshActivity}
          />
          <section className="space-y-2 rounded-lg border border-border bg-card p-4">
            <div>
              <h2 className="font-semibold">Calls</h2>
              <p className="text-xs text-muted-foreground">Logged Twilio and Retell calls linked to this lead.</p>
            </div>
            <CallList leadId={lead.id} />
          </section>
          <LeadActivityCard activity={activity} />
        </div>
      </main>
    </div>
  )
}
