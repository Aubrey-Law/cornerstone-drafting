'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MatterAssistantQuickPrompts } from '@/app/admin/components/MatterAssistantQuickPrompts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel } from '@/lib/practiceArea'
import type { LeadEditableField } from '@/lib/leads/details'

export type LeadRecord = {
  [key: string]: unknown
  id: string
  first_name?: string | null
  middle_name?: string | null
  last_name?: string | null
  preferred_name?: string | null
  full_name?: string | null
  email?: string | null
  phone?: string | null
  date_of_birth?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  marital_status?: string | null
  practice_area?: string | null
  lead_source?: string | null
  engagement_fee_quoted?: number | null
  lead_urgency?: string | null
  taxable_estate?: number | null
  has_minor_children?: boolean | null
  qualification_notes?: string | null
}

export type LeadSpouse = {
  first_name?: string | null
  middle_name?: string | null
  last_name?: string | null
  preferred_name?: string | null
  email?: string | null
  phone?: string | null
  date_of_birth?: string | null
}

type FieldDefinition = {
  key: LeadEditableField
  label: string
  missingLabel: string
  complete: (lead: LeadRecord, spouse: LeadSpouse | null) => boolean
  display: (lead: LeadRecord, spouse: LeadSpouse | null) => string | null
  input: 'text' | 'email' | 'date' | 'number' | 'select' | 'textarea' | 'address' | 'spouse'
  options?: readonly { value: string; label: string }[]
}

type AddressDraft = {
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  zip: string
  county: string
}

type SpouseDraft = {
  firstName: string
  middleName: string
  lastName: string
  preferredName: string
  email: string
  phone: string
  dateOfBirth: string
}

export type LeadDetailsCardProps = {
  lead: LeadRecord
  spouse: LeadSpouse | null
  activeField: LeadEditableField | null
  onActiveFieldChange: (field: LeadEditableField | null) => void
  onSaveField: (field: LeadEditableField, value: unknown) => Promise<void>
  onRemoveSpouse: () => void
}

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const money = (value: number | null | undefined) => value == null ? null : `$${Number(value).toLocaleString()}`
const joined = (values: unknown[], separator = ' ') => {
  const text = values.filter(hasText).map(value => value.trim()).join(separator)
  return text || null
}

const MARITAL_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
] as const

const URGENCY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const

const MINOR_CHILDREN_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
] as const

const FIELD_DEFINITIONS: readonly FieldDefinition[] = [
  {
    key: 'firstName',
    label: 'Name',
    missingLabel: 'Name',
    complete: lead => hasText(lead.first_name) && hasText(lead.last_name),
    display: lead => joined([lead.first_name, lead.middle_name, lead.last_name]),
    input: 'text',
  },
  {
    key: 'email',
    label: 'Email',
    missingLabel: 'Email',
    complete: lead => hasText(lead.email),
    display: lead => hasText(lead.email) ? lead.email : null,
    input: 'email',
  },
  {
    key: 'phone',
    label: 'Phone',
    missingLabel: 'Phone',
    complete: lead => hasText(lead.phone),
    display: lead => hasText(lead.phone) ? lead.phone : null,
    input: 'text',
  },
  {
    key: 'address',
    label: 'Address',
    missingLabel: 'Address',
    complete: lead => (
      hasText(lead.address_line1)
      && hasText(lead.city)
      && hasText(lead.state)
      && hasText(lead.zip)
    ),
    display: lead => joined([
      joined([lead.address_line1, lead.address_line2], ', '),
      lead.city,
      lead.state,
      lead.zip,
      lead.county,
    ], ', '),
    input: 'address',
  },
  {
    key: 'dateOfBirth',
    label: 'Date of birth',
    missingLabel: 'DOB',
    complete: lead => hasText(lead.date_of_birth),
    display: lead => hasText(lead.date_of_birth) ? lead.date_of_birth : null,
    input: 'date',
  },
  {
    key: 'maritalStatus',
    label: 'Marital status',
    missingLabel: 'Marital status',
    complete: lead => hasText(lead.marital_status),
    display: lead => hasText(lead.marital_status) ? titleCase(lead.marital_status) : null,
    input: 'select',
    options: MARITAL_OPTIONS,
  },
  {
    key: 'spouse',
    label: 'Spouse',
    missingLabel: 'Spouse',
    complete: (lead, spouse) => (
      lead.marital_status !== 'married'
      || Boolean(spouse && hasText(spouse.first_name) && hasText(spouse.last_name))
    ),
    display: (_lead, spouse) => spouse ? joined([spouse.first_name, spouse.middle_name, spouse.last_name]) : null,
    input: 'spouse',
  },
  {
    key: 'practiceArea',
    label: 'Practice area',
    missingLabel: 'Practice area',
    complete: lead => hasText(lead.practice_area),
    display: lead => hasText(lead.practice_area) ? practiceAreaLabel(lead.practice_area) : null,
    input: 'select',
    options: PRACTICE_AREA_OPTIONS,
  },
  {
    key: 'source',
    label: 'Lead source',
    missingLabel: 'Lead source',
    complete: lead => hasText(lead.lead_source),
    display: lead => hasText(lead.lead_source) ? lead.lead_source : null,
    input: 'text',
  },
  {
    key: 'fee',
    label: 'Quoted fee',
    missingLabel: 'Quoted fee',
    complete: lead => lead.engagement_fee_quoted != null,
    display: lead => money(lead.engagement_fee_quoted),
    input: 'number',
  },
  {
    key: 'urgency',
    label: 'Urgency',
    missingLabel: 'Urgency',
    complete: lead => hasText(lead.lead_urgency),
    display: lead => hasText(lead.lead_urgency) ? titleCase(lead.lead_urgency) : null,
    input: 'select',
    options: URGENCY_OPTIONS,
  },
  {
    key: 'estimatedEstateValue',
    label: 'Estimated estate value',
    missingLabel: 'Estate value',
    complete: lead => lead.taxable_estate != null,
    display: lead => money(lead.taxable_estate),
    input: 'number',
  },
  {
    key: 'hasMinorChildren',
    label: 'Minor children',
    missingLabel: 'Minor children',
    complete: lead => lead.has_minor_children != null,
    display: lead => lead.has_minor_children == null ? null : lead.has_minor_children ? 'Yes' : 'No',
    input: 'select',
    options: MINOR_CHILDREN_OPTIONS,
  },
  {
    key: 'qualificationNotes',
    label: 'Qualification notes',
    missingLabel: 'Qualification notes',
    complete: lead => hasText(lead.qualification_notes),
    display: lead => hasText(lead.qualification_notes) ? lead.qualification_notes : null,
    input: 'textarea',
  },
] as const

const PRIORITY_KEYS: readonly LeadEditableField[] = [
  'address',
  'maritalStatus',
  'spouse',
  'estimatedEstateValue',
  'hasMinorChildren',
  'fee',
  'urgency',
  'dateOfBirth',
]

const ASSISTANT_PROMPTS = [
  { label: 'Summarize intake', prompt: "Summarize this client's situation" },
  { label: 'Analyze MA estate tax', prompt: 'Analyze MA estate tax exposure' },
  { label: 'Draft a pre-call email', prompt: 'Draft a pre-call email for this lead' },
]

function valueForField(field: LeadEditableField, lead: LeadRecord, spouse: LeadSpouse | null): unknown {
  switch (field) {
    case 'firstName': return lead.first_name ?? ''
    case 'middleName': return lead.middle_name ?? ''
    case 'lastName': return lead.last_name ?? ''
    case 'preferredName': return lead.preferred_name ?? ''
    case 'email': return lead.email ?? ''
    case 'phone': return lead.phone ?? ''
    case 'dateOfBirth': return lead.date_of_birth ?? ''
    case 'address': return {
      addressLine1: lead.address_line1 ?? '',
      addressLine2: lead.address_line2 ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
      zip: lead.zip ?? '',
      county: lead.county ?? '',
    } satisfies AddressDraft
    case 'maritalStatus': return lead.marital_status ?? ''
    case 'practiceArea': return lead.practice_area ?? ''
    case 'source': return lead.lead_source ?? ''
    case 'fee': return lead.engagement_fee_quoted == null ? '' : String(lead.engagement_fee_quoted)
    case 'urgency': return lead.lead_urgency ?? ''
    case 'estimatedEstateValue': return lead.taxable_estate == null ? '' : String(lead.taxable_estate)
    case 'hasMinorChildren': return lead.has_minor_children == null ? '' : String(lead.has_minor_children)
    case 'qualificationNotes': return lead.qualification_notes ?? ''
    case 'spouse': return {
      firstName: spouse?.first_name ?? '',
      middleName: spouse?.middle_name ?? '',
      lastName: spouse?.last_name ?? '',
      preferredName: spouse?.preferred_name ?? '',
      email: spouse?.email ?? '',
      phone: spouse?.phone ?? '',
      dateOfBirth: spouse?.date_of_birth ?? '',
    } satisfies SpouseDraft
  }
}

function blankToNull(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

function normalizedValue(field: LeadEditableField, draft: unknown): unknown {
  if (field === 'address') {
    const address = draft as AddressDraft
    return {
      addressLine1: blankToNull(address.addressLine1),
      addressLine2: blankToNull(address.addressLine2),
      city: blankToNull(address.city),
      state: blankToNull(address.state),
      zip: blankToNull(address.zip),
      county: blankToNull(address.county),
    }
  }
  if (field === 'spouse') {
    const value = draft as SpouseDraft
    return {
      firstName: value.firstName.trim(),
      middleName: blankToNull(value.middleName),
      lastName: value.lastName.trim(),
      preferredName: blankToNull(value.preferredName),
      email: blankToNull(value.email),
      phone: blankToNull(value.phone),
      dateOfBirth: blankToNull(value.dateOfBirth),
    }
  }
  if (field === 'fee' || field === 'estimatedEstateValue') {
    return String(draft).trim() === '' ? null : Number(draft)
  }
  if (field === 'hasMinorChildren') {
    return draft === '' ? null : draft === 'true'
  }
  const value = String(draft).trim()
  return value || null
}

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</span>
}

export function LeadDetailsCard({
  lead,
  spouse,
  activeField,
  onActiveFieldChange,
  onSaveField,
  onRemoveSpouse,
}: LeadDetailsCardProps) {
  const [draft, setDraft] = useState<unknown>(null)
  const [savingField, setSavingField] = useState<LeadEditableField | null>(null)
  const [savedField, setSavedField] = useState<LeadEditableField | null>(null)
  const lastPersistedRef = useRef<unknown>(null)
  const savingRef = useRef(false)
  const triggerRefs = useRef<Partial<Record<LeadEditableField, HTMLButtonElement | null>>>({})

  useEffect(() => {
    if (!activeField) return
    const persisted = valueForField(activeField, lead, spouse)
    lastPersistedRef.current = persisted
    setDraft(persisted)
  }, [activeField, lead, spouse])

  const completeCount = FIELD_DEFINITIONS.filter(field => field.complete(lead, spouse)).length
  const statusField = savingField ?? savedField
  const statusDefinition = FIELD_DEFINITIONS.find(field => field.key === statusField)
  const missingFields = useMemo(() => {
    const incomplete = FIELD_DEFINITIONS.filter(field => !field.complete(lead, spouse))
    return [...incomplete].sort((left, right) => {
      const leftPriority = PRIORITY_KEYS.indexOf(left.key)
      const rightPriority = PRIORITY_KEYS.indexOf(right.key)
      if (leftPriority === -1 && rightPriority === -1) {
        return FIELD_DEFINITIONS.indexOf(left) - FIELD_DEFINITIONS.indexOf(right)
      }
      if (leftPriority === -1) return 1
      if (rightPriority === -1) return -1
      return leftPriority - rightPriority
    })
  }, [lead, spouse])

  function restoreTrigger(field: LeadEditableField) {
    requestAnimationFrame(() => triggerRefs.current[field]?.focus())
  }

  function openField(field: LeadEditableField) {
    setSavedField(null)
    onActiveFieldChange(field)
  }

  function cancelField(field: LeadEditableField) {
    setDraft(lastPersistedRef.current)
    onActiveFieldChange(null)
    restoreTrigger(field)
  }

  async function commitField(field: LeadEditableField, nextDraft = draft) {
    if (savingRef.current) return
    const value = normalizedValue(field, nextDraft)
    const persisted = normalizedValue(field, lastPersistedRef.current)
    if (equalValue(value, persisted)) {
      onActiveFieldChange(null)
      restoreTrigger(field)
      return
    }

    savingRef.current = true
    setSavingField(field)
    setSavedField(null)
    try {
      await onSaveField(field, value)
      setSavingField(null)
      setSavedField(field)
      onActiveFieldChange(null)
      restoreTrigger(field)
    } catch {
      setDraft(lastPersistedRef.current)
      setSavingField(null)
      setSavedField(null)
      onActiveFieldChange(null)
      restoreTrigger(field)
    } finally {
      savingRef.current = false
    }
  }

  function handleEditorBlur(field: LeadEditableField, event: React.FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    void commitField(field)
  }

  function handleEditorKeyDown(field: LeadEditableField, event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelField(field)
      return
    }
    if (
      event.key === 'Enter'
      && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
    ) {
      event.preventDefault()
      void commitField(field)
    }
  }

  function renderEditor(field: FieldDefinition) {
    const sharedContainerProps = {
      onBlur: (event: React.FocusEvent<HTMLDivElement>) => handleEditorBlur(field.key, event),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => handleEditorKeyDown(field.key, event),
    }
    const disabled = savingField === field.key

    if (field.input === 'address') {
      const address = draft as AddressDraft | null
      if (!address) return null
      const update = (key: keyof AddressDraft, value: string) => setDraft((current: unknown) => ({ ...(current as AddressDraft), [key]: value }))
      return (
        <div {...sharedContainerProps} className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-3">
          <label className="space-y-1"><FieldLabel>Address line 1</FieldLabel><Input autoFocus aria-label="Address line 1" disabled={disabled} value={address.addressLine1} onChange={event => update('addressLine1', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Address line 2</FieldLabel><Input aria-label="Address line 2" disabled={disabled} value={address.addressLine2} onChange={event => update('addressLine2', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>City</FieldLabel><Input aria-label="City" disabled={disabled} value={address.city} onChange={event => update('city', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>State</FieldLabel><Input aria-label="State" disabled={disabled} value={address.state} onChange={event => update('state', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>ZIP</FieldLabel><Input aria-label="ZIP" disabled={disabled} value={address.zip} onChange={event => update('zip', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>County</FieldLabel><Input aria-label="County" disabled={disabled} value={address.county} onChange={event => update('county', event.target.value)} /></label>
        </div>
      )
    }

    if (field.input === 'spouse') {
      const spouseDraft = draft as SpouseDraft | null
      if (!spouseDraft) return null
      const update = (key: keyof SpouseDraft, value: string) => setDraft((current: unknown) => ({ ...(current as SpouseDraft), [key]: value }))
      return (
        <div {...sharedContainerProps} className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-3">
          <label className="space-y-1"><FieldLabel>Spouse first name</FieldLabel><Input autoFocus aria-label="Spouse first name" disabled={disabled} value={spouseDraft.firstName} onChange={event => update('firstName', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Spouse middle name</FieldLabel><Input aria-label="Spouse middle name" disabled={disabled} value={spouseDraft.middleName} onChange={event => update('middleName', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Spouse last name</FieldLabel><Input aria-label="Spouse last name" disabled={disabled} value={spouseDraft.lastName} onChange={event => update('lastName', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Spouse preferred name</FieldLabel><Input aria-label="Spouse preferred name" disabled={disabled} value={spouseDraft.preferredName} onChange={event => update('preferredName', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Spouse email</FieldLabel><Input aria-label="Spouse email" disabled={disabled} type="email" value={spouseDraft.email} onChange={event => update('email', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Spouse phone</FieldLabel><Input aria-label="Spouse phone" disabled={disabled} value={spouseDraft.phone} onChange={event => update('phone', event.target.value)} /></label>
          <label className="space-y-1"><FieldLabel>Spouse date of birth</FieldLabel><Input aria-label="Spouse date of birth" disabled={disabled} type="date" value={spouseDraft.dateOfBirth} onChange={event => update('dateOfBirth', event.target.value)} /></label>
          <div className="flex items-end gap-2">
            {spouse ? (
              <Button type="button" variant="outline" onClick={onRemoveSpouse}>Remove spouse</Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => cancelField('spouse')}>Cancel spouse</Button>
            )}
            <Button type="button" disabled={disabled} onClick={() => void commitField('spouse')}>Save spouse</Button>
          </div>
        </div>
      )
    }

    if (field.input === 'select') {
      return (
        <div {...sharedContainerProps} className="space-y-1">
          <FieldLabel>{field.label}</FieldLabel>
          <select
            autoFocus
            aria-label={field.label}
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
            disabled={disabled}
            value={String(draft ?? '')}
            onChange={event => {
              const next = event.target.value
              setDraft(next)
              void commitField(field.key, next)
            }}
          >
            <option value="">Not set</option>
            {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      )
    }

    if (field.input === 'textarea') {
      return (
        <div {...sharedContainerProps} className="space-y-1 lg:col-span-3">
          <FieldLabel>{field.label}</FieldLabel>
          <Textarea autoFocus aria-label={field.label} disabled={disabled} value={String(draft ?? '')} onChange={event => setDraft(event.target.value)} />
        </div>
      )
    }

    return (
      <div {...sharedContainerProps} className="space-y-1">
        <FieldLabel>{field.label}</FieldLabel>
        <Input
          autoFocus
          aria-label={field.label}
          disabled={disabled}
          min={field.input === 'number' ? 0 : undefined}
          type={field.input}
          value={String(draft ?? '')}
          onChange={event => setDraft(event.target.value)}
        />
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Lead details</h2>
            <p className="text-[11px] text-muted-foreground">Contact, household, and qualification details.</p>
          </div>
          <p className="text-xs font-medium text-muted-foreground">{completeCount} of 14 complete</p>
        </div>

        <div
          aria-label="Lead details completeness"
          aria-valuemax={14}
          aria-valuemin={0}
          aria-valuenow={completeCount}
          className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${(completeCount / 14) * 100}%` }} />
        </div>

        <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_DEFINITIONS.map(field => {
            const display = field.display(lead, spouse)
            if (activeField === field.key) {
              return (
                <div key={field.key} className={field.input === 'address' || field.input === 'spouse' || field.input === 'textarea' ? 'lg:col-span-3' : ''}>
                  {renderEditor(field)}
                </div>
              )
            }
            if (display == null) return null
            return (
              <div key={field.key} className={field.key === 'qualificationNotes' ? 'lg:col-span-3' : ''}>
                <FieldLabel>{field.label}</FieldLabel>
                <button
                  aria-label={`Edit ${field.label}`}
                  className="mt-1 w-full rounded-sm text-left text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  ref={element => { triggerRefs.current[field.key] = element }}
                  type="button"
                  onClick={() => openField(field.key)}
                >
                  <span className={field.key === 'qualificationNotes' ? 'whitespace-pre-wrap font-normal' : ''}>{display}</span>
                </button>
              </div>
            )
          })}
        </div>

        {statusDefinition && (
          <span aria-label={`${statusDefinition.label} save status`} aria-live="polite" className="mt-2 block text-[11px] text-muted-foreground" role="status">
            {savingField ? 'Saving' : 'Saved'}
          </span>
        )}

        {missingFields.some(field => field.key !== activeField) && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            {missingFields.filter(field => field.key !== activeField).map(field => (
              <button
                key={field.key}
                className="h-7 rounded-full border border-dashed border-border px-3 text-xs font-medium text-muted-foreground outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                ref={element => { triggerRefs.current[field.key] = element }}
                type="button"
                onClick={() => openField(field.key)}
              >
                + Add {field.missingLabel}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-border bg-muted/40 px-4 py-3 md:px-5">
        <p className="text-xs text-muted-foreground">Intake answers land here automatically — you rarely need to type these.</p>
        <MatterAssistantQuickPrompts className="mt-2 flex flex-wrap gap-2" prompts={ASSISTANT_PROMPTS} />
      </footer>
    </section>
  )
}
