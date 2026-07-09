'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { dedupePickerContacts } from '@/lib/intakeContactPickerRows'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

/** Matches `FiduciaryEntry` in IntakeWizard — kept local to avoid circular imports. */
export interface FiduciaryPickerEntry {
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  relationship: string
  phone: string
  email: string
  address: string
  street: string
  city: string
  state: string
  zip: string
  priority: number
  is_coagent?: boolean
  contact_id?: string
  [key: string]: unknown
}

interface ContactRecord {
  id: string
  first_name: string
  last_name: string
  middle_name?: string | null
  suffix?: string | null
  email?: string | null
  phone?: string | null
  relationship_type?: string | null
  relationship_label?: string | null
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  _builtin?: boolean
  _label?: string
}

const LABELED_REL_TYPES = new Set(['client', 'spouse', 'child'])

const EMPTY_SLOT: Omit<FiduciaryPickerEntry, 'priority' | 'is_coagent'> = {
  first_name: '',
  middle_name: '',
  last_name: '',
  suffix: '',
  relationship: '',
  phone: '',
  email: '',
  address: '',
  street: '',
  city: '',
  state: '',
  zip: '',
}

function emptyPreserveSlot(template: FiduciaryPickerEntry): FiduciaryPickerEntry {
  // Explicit cast: spreading `Omit<..., 'priority' | 'is_coagent'>` plus optional fields does not
  // infer cleanly against `FiduciaryPickerEntry`'s index signature.
  return {
    ...EMPTY_SLOT,
    priority: template.priority,
    is_coagent: template.is_coagent,
  } as FiduciaryPickerEntry
}

function contactMatchesEntry(contact: ContactRecord, entry: FiduciaryPickerEntry): boolean {
  const cid = typeof entry.contact_id === 'string' ? entry.contact_id : null
  if (cid && typeof contact.id === 'string' && contact.id === cid) return true
  const norm = (s: string | undefined | null) => (s ?? '').trim().toLowerCase()
  return norm(contact.first_name) === norm(entry.first_name) && norm(contact.last_name) === norm(entry.last_name)
}

function fiduciaryEntryFromContact(contact: ContactRecord, template: FiduciaryPickerEntry): FiduciaryPickerEntry {
  const labelOrType =
    contact.relationship_label ??
    (contact.relationship_type && contact.relationship_type !== 'other'
      ? contact.relationship_type
      : '')
  const street = (contact.address_line1 ?? '').trim()
  const city = (contact.city ?? '').trim()
  const state = (contact.state ?? '').trim()
  const zip = (contact.zip ?? '').trim()
  const line =
    composedAddressOneLine({ street, city, state, zip }) ||
    street ||
    ''
  const contactId =
    typeof contact.id === 'string' && !contact.id.startsWith('local-') ? contact.id : undefined

  return {
    ...template,
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    middle_name: (contact.middle_name ?? template.middle_name ?? '').trim(),
    suffix: (contact.suffix ?? template.suffix ?? '').trim(),
    email: (contact.email ?? '') || '',
    phone: (contact.phone ?? '') || '',
    street,
    city,
    state,
    zip,
    address: line,
    relationship: labelOrType,
    contact_id: contactId,
  }
}

async function fetchMergedContacts(
  intakeId: string,
  localContacts: FiduciaryPickerEntry[],
): Promise<ContactRecord[]> {
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .eq('client_intake_id', intakeId)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  const dbResults: ContactRecord[] = (data ?? []).map((c: ContactRecord) => ({
    ...c,
    _label: LABELED_REL_TYPES.has(c.relationship_type ?? '') ? (c.relationship_type ?? undefined) : undefined,
  }))

  const seen = new Set(
    dbResults.map((c) =>
      `${(c.first_name ?? '').trim().toLowerCase()}|${(c.last_name ?? '').trim().toLowerCase()}`,
    ),
  )

  const localExtras = localContacts
    .filter((c) => c.first_name && c.last_name)
    .filter(
      (c) =>
        !seen.has(`${c.first_name.trim().toLowerCase()}|${c.last_name.trim().toLowerCase()}`),
    )
    .map((c) => {
      const isBuiltinEntry =
        c.relationship === 'client' || c.relationship === 'spouse' || c.relationship === 'child'
      const street = (typeof c.street === 'string' ? c.street : '').trim()
      const city = (typeof c.city === 'string' ? c.city : '').trim()
      const state = (typeof c.state === 'string' ? c.state : '').trim()
      const zip = (typeof c.zip === 'string' ? c.zip : '').trim()
      const line =
        composedAddressOneLine({ street, city, state, zip }) ||
        (typeof c.address === 'string' ? c.address.trim() : '') ||
        null
      return {
        id: `local-${c.first_name}-${c.last_name}-${c.priority}-${String(c.relationship ?? '')}`,
        first_name: c.first_name,
        last_name: c.last_name,
        middle_name: c.middle_name || null,
        suffix: c.suffix || null,
        email: c.email || null,
        phone: formatPhoneDisplay(c.phone) || null,
        relationship_type: isBuiltinEntry ? c.relationship : 'other',
        relationship_label: isBuiltinEntry ? null : (c.relationship || null),
        address_line1: street || line,
        city: city || null,
        state: state || null,
        zip: zip || null,
        _builtin: isBuiltinEntry,
        _label: isBuiltinEntry ? c.relationship : undefined,
      } as ContactRecord
    })

  return dedupePickerContacts([...dbResults, ...localExtras])
}

/** Inline checkbox contact picker + inline “Add contact” form. */
export function ContactPickerField({
  intakeId,
  value,
  onChange,
  label,
  onRemove,
  localContacts = [],
  FormField,
  Row2,
  TextInput,
  PhoneInput,
  SelectInput,
  ContactAddressFields,
  suffixOptions,
}: {
  intakeId: string
  value: FiduciaryPickerEntry
  onChange: (entry: FiduciaryPickerEntry) => void
  label: string
  onRemove?: () => void
  localContacts?: FiduciaryPickerEntry[]
  FormField: ComponentType<{ label: string; children: ReactNode; className?: string }>
  Row2: ComponentType<{ children: ReactNode }>
  TextInput: ComponentType<{
    value: string
    onChange: (val: string) => void
    placeholder?: string
    type?: string
    required?: boolean
  }>
  PhoneInput: ComponentType<{ value: string; onChange: (val: string) => void }>
  SelectInput: ComponentType<{
    value: string
    onChange: (val: string) => void
    placeholder?: string
    options: { value: string; label: string }[]
  }>
  ContactAddressFields: ComponentType<{
    street: string
    city: string
    state: string
    zip: string
    county: string
    onStreetChange: (v: string) => void
    onCityChange: (v: string) => void
    onStateChange: (v: string) => void
    onZipChange: (v: string) => void
    onCountyChange: (v: string) => void
    onAddressSelect: (addr: { street: string; city: string; state: string; zip: string }) => void
  }>
  suffixOptions: { value: string; label: string }[]
}) {
  const [panel, setPanel] = useState<'pick' | 'add'>('pick')
  const [rows, setRows] = useState<ContactRecord[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [saving, setSaving] = useState(false)
  const localContactsRef = useRef(localContacts)

  const localContactsKey = localContacts
    .map((c) =>
      [
        c.contact_id,
        c.first_name,
        c.last_name,
        c.relationship,
        c.priority,
        c.is_coagent ? 'co' : 'principal',
      ].join(':'),
    )
    .join('|')

  useEffect(() => {
    localContactsRef.current = localContacts
  }, [localContacts])

  const refreshRows = useCallback(async () => {
    setLoadingRows(true)
    try {
      const merged = await fetchMergedContacts(intakeId, localContactsRef.current)
      setRows(merged)
    } catch {
      toast.error('Could not load contacts')
    } finally {
      setLoadingRows(false)
    }
  }, [intakeId])

  useEffect(() => {
    void refreshRows()
  }, [refreshRows, localContactsKey])

  function pickContact(contact: ContactRecord) {
    onChange(fiduciaryEntryFromContact(contact, value))
  }

  function toggleRow(contact: ContactRecord, checked: boolean) {
    if (checked) {
      pickContact(contact)
      return
    }
    if (contactMatchesEntry(contact, value)) {
      onChange(emptyPreserveSlot(value))
    }
  }

  function updateField(field: string, val: string) {
    onChange({ ...value, [field]: val })
  }

  async function saveNewContactToDb() {
    if (!value.first_name?.trim() || !value.last_name?.trim()) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')
      const composed = [value.street, value.city, value.state, value.zip].filter(Boolean).join(', ')
      const address = (typeof value.address === 'string' && value.address.trim()) || composed.trim() || null
      const res = await fetch('/api/intake/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'upsert_contact',
          intakeId,
          first_name: value.first_name,
          last_name: value.last_name,
          email: value.email || null,
          phone: formatPhoneForStorage(value.phone),
          address,
          relationship: value.relationship || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Save failed')
      }
      toast.success(`${value.first_name} ${value.last_name} saved`)
      const merged = await fetchMergedContacts(intakeId, localContactsRef.current)
      setRows(merged)
      const fn = value.first_name.trim().toLowerCase()
      const ln = value.last_name.trim().toLowerCase()
      const match = merged.find(
        (r) =>
          r.first_name.trim().toLowerCase() === fn &&
          r.last_name.trim().toLowerCase() === ln,
      )
      if (match) onChange(fiduciaryEntryFromContact(match, value))
      setPanel('pick')
    } catch (err) {
      console.error('Save contact error:', err)
      toast.error('Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  const summary =
    value.first_name?.trim() || value.last_name?.trim()
      ? `${value.first_name ?? ''} ${value.last_name ?? ''}`.trim()
      : null

  return (
    <div className="space-y-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-medium uppercase text-gray-500">{label}</span>
          {summary ? (
            <p className="mt-1 text-sm font-medium text-gray-900">{summary}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Choose one contact from the list below.</p>
          )}
        </div>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="text-red-500 hover:text-red-700">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {panel === 'pick' ? (
        <>
          <div className="space-y-1 rounded-md border border-border bg-background p-2">
            {loadingRows && rows.length === 0 ? (
              <div className="flex justify-center py-6 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                No contacts yet. Complete earlier sections or add a contact here.
              </p>
            ) : (
              rows.map((c) => {
                const checked = contactMatchesEntry(c, value)
                const detail = [
                  c.relationship_label ?? c.relationship_type,
                  c.email,
                  formatPhoneDisplay(c.phone),
                ].filter(Boolean).join(' · ')

                return (
                  <label
                    key={c.id}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
                      checked
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-transparent hover:bg-muted',
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(chk) => toggleRow(c, chk === true)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block font-medium text-gray-900">
                        {c.first_name} {c.last_name}
                        {c._label && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] capitalize text-muted-foreground">
                            {c._label}
                          </span>
                        )}
                      </span>
                      {detail && (
                        <span className="mt-0.5 block break-words text-xs text-muted-foreground sm:truncate">
                          {detail}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => void refreshRows()} disabled={loadingRows}>
              {loadingRows ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh contacts'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPanel('add')}>
              <Plus className="mr-1 h-4 w-4" />
              Add contact
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-md border border-border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">Add contact</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanel('pick')}>
              Back to list
            </Button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="First Name">
                <TextInput value={value.first_name} onChange={(v) => updateField('first_name', v)} />
              </FormField>
              <FormField label="Middle Name">
                <TextInput value={value.middle_name ?? ''} onChange={(v) => updateField('middle_name', v)} />
              </FormField>
              <FormField label="Last Name">
                <TextInput value={value.last_name} onChange={(v) => updateField('last_name', v)} />
              </FormField>
              <FormField label="Suffix">
                <SelectInput
                  value={value.suffix ?? ''}
                  onChange={(v) => updateField('suffix', v)}
                  placeholder="—"
                  options={suffixOptions}
                />
              </FormField>
            </div>
            <Row2>
              <FormField label="Email">
                <TextInput value={value.email} onChange={(v) => updateField('email', v)} type="email" />
              </FormField>
              <FormField label="Phone">
                <PhoneInput value={value.phone} onChange={(v) => updateField('phone', v)} />
              </FormField>
            </Row2>
            <Row2>
              <FormField label="Relationship">
                <TextInput
                  value={value.relationship}
                  onChange={(v) => updateField('relationship', v)}
                  placeholder="e.g., Sister, Friend"
                />
              </FormField>
            </Row2>
            <ContactAddressFields
              street={value.street ?? ''}
              city={value.city ?? ''}
              state={value.state ?? ''}
              zip={value.zip ?? ''}
              county=""
              onStreetChange={(v) => updateField('street', v)}
              onCityChange={(v) => updateField('city', v)}
              onStateChange={(v) => updateField('state', v)}
              onZipChange={(v) => updateField('zip', v)}
              onCountyChange={() => {}}
              onAddressSelect={(addr) => {
                updateField('street', addr.street)
                updateField('city', addr.city)
                updateField('state', addr.state || 'MA')
                updateField('zip', addr.zip)
              }}
            />
          </div>

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setPanel('pick')}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveNewContactToDb()} disabled={saving}>
              {saving ? 'Saving...' : 'Save contact'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
