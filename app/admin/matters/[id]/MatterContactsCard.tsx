'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader as Loader2, Pencil, Mail, MapPin, Phone, Save as SaveIcon, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay, phoneTelHref } from '@/lib/phone'
import { formatDobWithAge } from '@/lib/dob'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FiduciaryContactTools, type FiduciaryContactInput } from '@/components/admin/FiduciaryContactTools'
import { PRONOUN_OPTIONS } from '@/lib/sharedFields/options'

interface ClientRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  date_of_birth: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  city: string | null
  state: string | null
  zip: string | null
}

interface ContactRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  date_of_birth: string | null
  relationship_type: string | null
  relationship_label: string | null
  role_labels: string[]
}

type ApiResponse = { client: ClientRow; contacts: ContactRow[] }

function joinAddress(parts: Array<string | null | undefined>): string | null {
  return parts.filter(Boolean).join(', ') || null
}

function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
  middle?: string | null | undefined,
  suffix?: string | null | undefined,
): string {
  return [first, middle, last, suffix].filter(Boolean).join(' ').trim()
}

function personDetails(preferredName?: string | null, pronouns?: string | null, dob?: string | null): string | null {
  return [
    preferredName ? `Goes by ${preferredName}` : null,
    pronouns,
    dob ? (formatDobWithAge(dob) ?? `DOB ${dob}`) : null,
  ].filter(Boolean).join(' · ') || null
}

function initials(first: string | null | undefined, last: string | null | undefined): string {
  return `${(first ?? '').charAt(0)}${(last ?? '').charAt(0)}`.toUpperCase() || '?'
}

export function MatterContactsCard({ matterId }: { matterId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null) // 'client' or contact id

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/contacts`)
      if (!res.ok) throw new Error('Failed to load contacts')
      const json = await res.json() as ApiResponse
      setData(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [matterId])

  useEffect(() => { void refresh() }, [refresh])

  async function handleAddContacts(contacts: FiduciaryContactInput[]) {
    const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Failed to save contacts')
    await refresh()
  }

  async function handleDeleteContact(contact: ContactRow) {
    const label = fullName(contact.first_name, contact.last_name, contact.middle_name, contact.suffix) || 'this contact'
    if (!window.confirm(`Remove ${label} from this matter?`)) return
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/contacts?contactId=${encodeURIComponent(contact.id)}`, {
        method: 'DELETE',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to remove contact')
      toast.success('Contact removed')
      if (editingId === contact.id) setEditingId(null)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove contact')
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-[11px] text-text-tertiary">
        Loading contacts…
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-[11px] text-text-tertiary">
        No contact data available.
      </div>
    )
  }

  const spouse = data.contacts.find(c => c.relationship_type === 'spouse')
  const children = data.contacts.filter(c => c.relationship_type === 'child')
  const fiduciaries = data.contacts.filter(c =>
    c.relationship_type !== 'spouse' && c.relationship_type !== 'child' &&
    (c.role_labels?.length ?? 0) > 0
  )
  const otherContacts = data.contacts.filter(c =>
    c.relationship_type !== 'spouse' && c.relationship_type !== 'child' &&
    (c.role_labels?.length ?? 0) === 0
  )

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-surface-1 px-4 py-3">
        <span className="text-[11.5px] font-semibold text-text-secondary">Contacts</span>
        <div className="mt-3">
          <FiduciaryContactTools onSubmit={handleAddContacts} />
        </div>
      </div>
      <div className="divide-y divide-border/60">
        <ClientRowEditor
          row={data.client}
          editing={editingId === 'client'}
          onStartEdit={() => setEditingId('client')}
          onCancel={() => setEditingId(null)}
          onSaved={async () => { setEditingId(null); await refresh() }}
          matterId={matterId}
        />
        {spouse && (
          <ContactRowEditor
            contact={spouse}
            roleLabel="Spouse"
            roleClass="bg-teal-12 text-accent"
            editing={editingId === spouse.id}
            onStartEdit={() => setEditingId(spouse.id)}
            onCancel={() => setEditingId(null)}
            onSaved={async () => { setEditingId(null); await refresh() }}
            matterId={matterId}
          />
        )}
        {children.length > 0 && (
          <GroupSection title="Children">
            {children.map(c => (
              <ContactRowEditor
                key={c.id}
                contact={c}
                roleLabel="Child"
                roleClass="bg-amber-bg text-amber"
                editing={editingId === c.id}
                onStartEdit={() => setEditingId(c.id)}
                onCancel={() => setEditingId(null)}
                onSaved={async () => { setEditingId(null); await refresh() }}
                matterId={matterId}
                onDelete={() => void handleDeleteContact(c)}
                showDob
              />
            ))}
          </GroupSection>
        )}
        {fiduciaries.length > 0 && (
          <GroupSection title="Fiduciaries">
            {fiduciaries.map(c => (
              <ContactRowEditor
                key={c.id}
                contact={c}
                roleLabel={c.role_labels.join(' · ')}
                roleClass="bg-navy-06 text-brand-navy"
                editing={editingId === c.id}
                onStartEdit={() => setEditingId(c.id)}
                onCancel={() => setEditingId(null)}
                onSaved={async () => { setEditingId(null); await refresh() }}
                matterId={matterId}
                onDelete={() => void handleDeleteContact(c)}
              />
            ))}
          </GroupSection>
        )}
        {otherContacts.length > 0 && (
          <GroupSection title="Other Contacts">
            {otherContacts.map(c => (
              <ContactRowEditor
                key={c.id}
                contact={c}
                roleLabel={c.relationship_label ?? 'Contact'}
                roleClass="bg-muted text-muted-foreground"
                editing={editingId === c.id}
                onStartEdit={() => setEditingId(c.id)}
                onCancel={() => setEditingId(null)}
                onSaved={async () => { setEditingId(null); await refresh() }}
                matterId={matterId}
                onDelete={() => void handleDeleteContact(c)}
              />
            ))}
          </GroupSection>
        )}
      </div>
    </div>
  )
}

function GroupSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

interface ContactRowEditorProps {
  contact: ContactRow
  roleLabel: string
  roleClass: string
  editing: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSaved: () => void | Promise<void>
  matterId: string
  onDelete?: () => void
  showDob?: boolean
}

function ContactRowEditor({
  contact, roleLabel, roleClass, editing, onStartEdit, onCancel, onSaved, matterId, onDelete, showDob,
}: ContactRowEditorProps) {
  const [draft, setDraft] = useState(() => toContactDraft(contact))
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (!editing) setDraft(toContactDraft(contact)) }, [contact, editing])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'contact',
          contactId: contact.id,
          patch: draft,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      toast.success('Saved')
      await onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <ContactEditFields
        draft={draft}
        setDraft={setDraft}
        onCancel={onCancel}
        onSave={handleSave}
        saving={saving}
        showDob={showDob}
        showRelationshipLabel={contact.relationship_type !== 'spouse' && contact.relationship_type !== 'child'}
      />
    )
  }

  const address = joinAddress([contact.address_line1])
  return (
    <ContactRowDisplay
      avatarText={initials(contact.first_name, contact.last_name)}
      name={fullName(contact.first_name, contact.last_name, contact.middle_name, contact.suffix) || '—'}
      roleLabel={roleLabel}
      roleClass={roleClass}
      email={contact.email}
      phone={contact.phone}
      address={address}
      onEdit={onStartEdit}
      onDelete={onDelete}
      extra={personDetails(contact.preferred_name, contact.preferred_pronoun, showDob ? contact.date_of_birth : null)}
    />
  )
}

function ClientRowEditor({
  row, editing, onStartEdit, onCancel, onSaved, matterId,
}: {
  row: ClientRow
  editing: boolean
  onStartEdit: () => void
  onCancel: () => void
  onSaved: () => void | Promise<void>
  matterId: string
}) {
  const [draft, setDraft] = useState(() => toClientDraft(row))
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (!editing) setDraft(toClientDraft(row)) }, [row, editing])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'client', patch: draft }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Save failed')
      }
      toast.success('Saved')
      await onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <ClientEditFields
        draft={draft}
        setDraft={setDraft}
        onCancel={onCancel}
        onSave={handleSave}
        saving={saving}
      />
    )
  }

  return (
    <ContactRowDisplay
      avatarText={initials(row.first_name, row.last_name)}
      avatarClass="bg-brand-navy"
      name={fullName(row.first_name, row.last_name, row.middle_name, row.suffix) || '—'}
      roleLabel="Primary"
      roleClass="bg-navy-06 text-brand-navy"
      email={row.email}
      phone={row.phone}
      address={joinAddress([row.address_line1, row.city, row.state, row.zip])}
      onEdit={onStartEdit}
      extra={personDetails(row.preferred_name, row.preferred_pronoun, row.date_of_birth)}
    />
  )
}

function ContactRowDisplay({
  avatarText, avatarClass = 'bg-accent', name, roleLabel, roleClass, email, phone, address, onEdit, onDelete, extra,
}: {
  avatarText: string
  avatarClass?: string
  name: string
  roleLabel: string
  roleClass: string
  email: string | null
  phone: string | null
  address: string | null
  onEdit: () => void
  onDelete?: () => void
  extra: string | null
}) {
  return (
    <div className="flex gap-2.5 px-4 py-3">
      <div className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-sm',
        avatarClass,
      )}>
        {avatarText}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-semibold text-foreground truncate">{name}</span>
          <span className={cn('rounded px-1 py-px text-[9px] font-semibold capitalize', roleClass)}>
            {roleLabel}
          </span>
        </div>
        {email && <p className="truncate text-[11px] text-muted-foreground">{email}</p>}
        {phone && <p className="truncate text-[11px] text-muted-foreground">{formatPhoneDisplay(phone)}</p>}
        {address && (
          <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            <span className="truncate">{address}</span>
          </p>
        )}
        {extra && <p className="text-[11px] text-muted-foreground">{extra}</p>}
        <div className="mt-1.5 flex gap-1">
          {email && (
            <a href={`mailto:${email}`} title="Email" className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors">
              <Mail className="h-3 w-3" />
            </a>
          )}
          {phoneTelHref(phone) && (
            <a href={phoneTelHref(phone) ?? undefined} title="Call" className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors">
              <Phone className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Remove contact"
              className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type ClientDraft = {
  first_name: string; middle_name: string; last_name: string; email: string; phone: string
  suffix: string; preferred_name: string; preferred_pronoun: string; date_of_birth: string
  address_line1: string; city: string; state: string; zip: string
}

function toClientDraft(c: ClientRow): ClientDraft {
  return {
    first_name: c.first_name ?? '',
    middle_name: c.middle_name ?? '',
    last_name: c.last_name ?? '',
    suffix: c.suffix ?? '',
    preferred_name: c.preferred_name ?? '',
    preferred_pronoun: c.preferred_pronoun ?? '',
    date_of_birth: c.date_of_birth ?? '',
    email: c.email ?? '',
    phone: formatPhoneDisplay(c.phone),
    address_line1: c.address_line1 ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    zip: c.zip ?? '',
  }
}

function ClientEditFields({
  draft, setDraft, onCancel, onSave, saving,
}: {
  draft: ClientDraft
  setDraft: React.Dispatch<React.SetStateAction<ClientDraft>>
  onCancel: () => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Input value={draft.first_name} onChange={e => setDraft(d => ({ ...d, first_name: e.target.value }))} placeholder="First" className="h-8 text-[13px]" />
        <Input value={draft.middle_name} onChange={e => setDraft(d => ({ ...d, middle_name: e.target.value }))} placeholder="Middle" className="h-8 text-[13px]" />
        <Input value={draft.last_name} onChange={e => setDraft(d => ({ ...d, last_name: e.target.value }))} placeholder="Last" className="h-8 text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input value={draft.suffix} onChange={e => setDraft(d => ({ ...d, suffix: e.target.value }))} placeholder="Suffix" className="h-8 text-[13px]" />
        <Input value={draft.preferred_name} onChange={e => setDraft(d => ({ ...d, preferred_name: e.target.value }))} placeholder="Preferred name" className="h-8 text-[13px]" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" value={draft.date_of_birth} onChange={e => setDraft(d => ({ ...d, date_of_birth: e.target.value }))} className="h-8 text-[13px]" />
        <Select value={draft.preferred_pronoun || undefined} onValueChange={v => setDraft(d => ({ ...d, preferred_pronoun: v }))}>
          <SelectTrigger className="h-8 text-[13px]">
            <SelectValue placeholder="Pronouns" />
          </SelectTrigger>
          <SelectContent>
            {PRONOUN_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} placeholder="Email" className="h-8 text-[13px]" />
      <Input type="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" className="h-8 text-[13px]" />
      <Input value={draft.address_line1} onChange={e => setDraft(d => ({ ...d, address_line1: e.target.value }))} placeholder="Street" className="h-8 text-[13px]" />
      <div className="grid grid-cols-[1fr_60px_80px] gap-2">
        <Input value={draft.city} onChange={e => setDraft(d => ({ ...d, city: e.target.value }))} placeholder="City" className="h-8 text-[13px]" />
        <Input value={draft.state} onChange={e => setDraft(d => ({ ...d, state: e.target.value }))} placeholder="ST" className="h-8 text-[13px]" />
        <Input value={draft.zip} onChange={e => setDraft(d => ({ ...d, zip: e.target.value }))} placeholder="ZIP" className="h-8 text-[13px]" />
      </div>
      <EditActions onCancel={onCancel} onSave={onSave} saving={saving} />
    </div>
  )
}

type ContactDraft = {
  first_name: string; middle_name: string; last_name: string; email: string; phone: string
  suffix: string; preferred_name: string; preferred_pronoun: string
  address_line1: string; date_of_birth: string; relationship_label: string
}

function toContactDraft(c: ContactRow): ContactDraft {
  return {
    first_name: c.first_name ?? '',
    middle_name: c.middle_name ?? '',
    last_name: c.last_name ?? '',
    suffix: c.suffix ?? '',
    preferred_name: c.preferred_name ?? '',
    preferred_pronoun: c.preferred_pronoun ?? '',
    email: c.email ?? '',
    phone: formatPhoneDisplay(c.phone),
    address_line1: c.address_line1 ?? '',
    date_of_birth: c.date_of_birth ?? '',
    relationship_label: c.relationship_label ?? '',
  }
}

function ContactEditFields({
  draft, setDraft, onCancel, onSave, saving, showDob, showRelationshipLabel,
}: {
  draft: ContactDraft
  setDraft: React.Dispatch<React.SetStateAction<ContactDraft>>
  onCancel: () => void
  onSave: () => void
  saving: boolean
  showDob?: boolean
  showRelationshipLabel?: boolean
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Input value={draft.first_name} onChange={e => setDraft(d => ({ ...d, first_name: e.target.value }))} placeholder="First" className="h-8 text-[13px]" />
        <Input value={draft.middle_name} onChange={e => setDraft(d => ({ ...d, middle_name: e.target.value }))} placeholder="Middle" className="h-8 text-[13px]" />
        <Input value={draft.last_name} onChange={e => setDraft(d => ({ ...d, last_name: e.target.value }))} placeholder="Last" className="h-8 text-[13px]" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input value={draft.suffix} onChange={e => setDraft(d => ({ ...d, suffix: e.target.value }))} placeholder="Suffix" className="h-8 text-[13px]" />
        <Input value={draft.preferred_name} onChange={e => setDraft(d => ({ ...d, preferred_name: e.target.value }))} placeholder="Preferred name" className="h-8 text-[13px]" />
        <Select value={draft.preferred_pronoun || undefined} onValueChange={v => setDraft(d => ({ ...d, preferred_pronoun: v }))}>
          <SelectTrigger className="h-8 text-[13px]">
            <SelectValue placeholder="Pronouns" />
          </SelectTrigger>
          <SelectContent>
            {PRONOUN_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} placeholder="Email" className="h-8 text-[13px]" />
      <Input type="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="Phone" className="h-8 text-[13px]" />
      <Input value={draft.address_line1} onChange={e => setDraft(d => ({ ...d, address_line1: e.target.value }))} placeholder="Address" className="h-8 text-[13px]" />
      {showRelationshipLabel && (
        <Input value={draft.relationship_label} onChange={e => setDraft(d => ({ ...d, relationship_label: e.target.value }))} placeholder="Relationship (e.g., Sister)" className="h-8 text-[13px]" />
      )}
      {showDob && (
        <Input type="date" value={draft.date_of_birth} onChange={e => setDraft(d => ({ ...d, date_of_birth: e.target.value }))} className="h-8 text-[13px]" />
      )}
      <EditActions onCancel={onCancel} onSave={onSave} saving={saving} />
    </div>
  )
}

function EditActions({ onCancel, onSave, saving }: { onCancel: () => void; onSave: () => void; saving: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving} className="h-7 text-[11px]">
        <X className="h-3 w-3 mr-1" /> Cancel
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={saving} className="h-7 text-[11px]">
        {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <SaveIcon className="h-3 w-3 mr-1" />}
        Save
      </Button>
    </div>
  )
}
