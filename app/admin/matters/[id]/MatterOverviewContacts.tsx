'use client'

import { listenForMatterContacts, notifyMatterContactsChanged } from '@/lib/matters/contactEvents'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { PersonContactCard, PersonContactCardGrid } from '@/components/matter/PersonContactCard'
import type { MatterContact, PipelineMatter } from '@/types/database'
import { formatPhoneDisplay } from '@/lib/phone'
import type { ClientFormValues, ContactFormValues } from './FamilyMemberDialog'
import { clientRowToForm, contactRowToForm } from './FamilyMemberDialog'
import type { PersonAddRequest } from './MatterPeopleTab'

const FamilyMemberDialog = dynamic(
  () => import('./FamilyMemberDialog').then(m => ({ default: m.FamilyMemberDialog })),
  { ssr: false },
)

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
  date_of_birth: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  relationship_type: string | null
  relationship_label: string | null
}

type ApiResponse = { client: ClientRow; contacts: ContactRow[] }

type DialogState =
  | { kind: 'edit-client' }
  | { kind: 'edit-spouse'; contact: ContactRow }
  | { kind: 'edit-child'; contact: ContactRow }
  | { kind: 'add-spouse' }
  | { kind: 'add-child' }
  | null

function clientToContact(client: ClientRow): MatterContact {
  const addressParts = [client.address_line1, client.city, client.state, client.zip].filter(Boolean)
  return {
    id: client.id,
    first_name: client.first_name ?? '',
    middle_name: client.middle_name,
    last_name: client.last_name ?? '',
    suffix: client.suffix,
    preferred_name: client.preferred_name,
    preferred_pronoun: client.preferred_pronoun,
    email: client.email,
    phone: formatPhoneDisplay(client.phone),
    address: addressParts.join(', ') || null,
    date_of_birth: client.date_of_birth,
    relationship: 'Client',
  }
}

function rowToContact(row: ContactRow): MatterContact {
  return {
    id: row.id,
    first_name: row.first_name ?? '',
    middle_name: row.middle_name,
    last_name: row.last_name ?? '',
    suffix: row.suffix,
    preferred_name: row.preferred_name,
    preferred_pronoun: row.preferred_pronoun,
    email: row.email,
    phone: formatPhoneDisplay(row.phone),
    address: row.address_line1,
    date_of_birth: row.date_of_birth,
    relationship: row.relationship_label ?? row.relationship_type,
  }
}

function contactName(contact: MatterContact | ContactRow): string {
  return [contact.first_name, contact.middle_name, contact.last_name].filter(Boolean).join(' ').trim() || 'this person'
}

function emptyPatchValues(values: ClientFormValues | ContactFormValues): Record<string, string | null> {
  const patch: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(values)) {
    patch[key] = value.trim() === '' ? null : value.trim()
  }
  return patch
}

export function MatterOverviewContacts({
  matterId,
  matter: _matter,
  addRequest,
}: {
  matterId: string
  matter: PipelineMatter
  addRequest?: PersonAddRequest | null
}) {
  const token = useAccessToken()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<DialogState>(null)

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }, [token])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      if (!res.ok) throw new Error('Failed to load contacts')
      setData(await res.json() as ApiResponse)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [matterId, token])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => listenForMatterContacts(matterId, () => { void refresh() }, 'people'), [matterId, refresh])

  const { clientContact, spouseContact, spouseRow, childContacts, childRows } = useMemo(() => {
    if (!data) {
      return {
        clientContact: null,
        spouseContact: null,
        spouseRow: null,
        childContacts: [] as MatterContact[],
        childRows: [] as ContactRow[],
      }
    }
    const spouse = data.contacts.find(c => c.relationship_type === 'spouse')
    const children = data.contacts.filter(c => c.relationship_type === 'child')
    return {
      clientContact: clientToContact(data.client),
      spouseContact: spouse ? rowToContact(spouse) : null,
      spouseRow: spouse ?? null,
      childContacts: children.map(rowToContact),
      childRows: children,
    }
  }, [data])

  const canAddSpouse = !spouseRow

  useEffect(() => {
    if (addRequest?.kind === 'spouse') {
      if (canAddSpouse) setDialog({ kind: 'add-spouse' })
      else toast.message('A spouse is already listed')
    } else if (addRequest?.kind === 'child') {
      setDialog({ kind: 'add-child' })
    }
  }, [addRequest?.kind, addRequest?.nonce, canAddSpouse])

  async function saveClient(values: ClientFormValues) {
    const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        target: 'client',
        patch: emptyPatchValues(values),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to save client')
    toast.success('Client saved')
    await refresh()
    notifyMatterContactsChanged(matterId, 'people')
  }

  async function saveExistingContact(contactId: string, values: ContactFormValues) {
    const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        target: 'contact',
        contactId,
        patch: emptyPatchValues(values),
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to save contact')
    toast.success('Saved')
    await refresh()
    notifyMatterContactsChanged(matterId, 'people')
  }

  async function addHouseholdMember(relationship_type: 'spouse' | 'child', values: ContactFormValues) {
    const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        household: {
          relationship_type,
          ...emptyPatchValues(values),
        },
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to add contact')
    toast.success(relationship_type === 'spouse' ? 'Spouse added' : 'Child added')
    await refresh()
    notifyMatterContactsChanged(matterId, 'people')
  }

  async function handleDeleteChild(contact: MatterContact) {
    if (!window.confirm(`Remove ${contactName(contact)} from this matter?`)) return
    try {
      const res = await fetch(
        `/api/admin/matters/${matterId}/contacts?contactId=${encodeURIComponent(contact.id)}`,
        { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to remove contact')
      toast.success('Child removed')
      await refresh()
      notifyMatterContactsChanged(matterId, 'people')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove contact')
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        Loading family contacts…
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Family</h3>
        <p className="text-xs text-muted-foreground">
          Client, spouse, and children from intake.
        </p>
      </div>
      <PersonContactCardGrid>
        {clientContact && (
          <PersonContactCard
            contact={clientContact}
            roleLabel="(Client)"
            onEdit={() => setDialog({ kind: 'edit-client' })}
          />
        )}
        {spouseContact && (
          <PersonContactCard
            contact={spouseContact}
            roleLabel="(Spouse)"
            onEdit={() => setDialog({ kind: 'edit-spouse', contact: spouseRow! })}
          />
        )}
        {childContacts.map((child, index) => (
          <PersonContactCard
            key={child.id}
            contact={child}
            roleLabel="(Child)"
            onEdit={() => setDialog({ kind: 'edit-child', contact: childRows[index] })}
            onDelete={() => void handleDeleteChild(child)}
          />
        ))}
      </PersonContactCardGrid>

      {!clientContact && (
        <p className="text-xs text-muted-foreground">No family contact data yet. Use Intake to add client information.</p>
      )}

      {dialog?.kind === 'edit-client' && data && (
        <FamilyMemberDialog
          open
          onOpenChange={open => { if (!open) setDialog(null) }}
          role="client"
          title="Edit Client"
          subtitle="Update the primary client details."
          initialClient={clientRowToForm(data.client)}
          onSaveClient={saveClient}
        />
      )}

      {dialog?.kind === 'edit-spouse' && (
        <FamilyMemberDialog
          open
          onOpenChange={open => { if (!open) setDialog(null) }}
          role="spouse"
          title="Edit Spouse"
          subtitle="Update spouse details."
          initialContact={contactRowToForm(dialog.contact)}
          onSaveContact={values => saveExistingContact(dialog.contact.id, values)}
        />
      )}

      {dialog?.kind === 'edit-child' && (
        <FamilyMemberDialog
          open
          onOpenChange={open => { if (!open) setDialog(null) }}
          role="child"
          title="Edit Child"
          subtitle="Update child details."
          initialContact={contactRowToForm(dialog.contact)}
          onSaveContact={values => saveExistingContact(dialog.contact.id, values)}
        />
      )}

      {dialog?.kind === 'add-spouse' && (
        <FamilyMemberDialog
          open
          onOpenChange={open => { if (!open) setDialog(null) }}
          role="spouse"
          title="Add Spouse"
          subtitle="Enter spouse details below."
          onSaveContact={values => addHouseholdMember('spouse', values)}
        />
      )}

      {dialog?.kind === 'add-child' && (
        <FamilyMemberDialog
          open
          onOpenChange={open => { if (!open) setDialog(null) }}
          role="child"
          title="Add Child"
          subtitle="Enter child details below."
          onSaveContact={values => addHouseholdMember('child', values)}
        />
      )}
    </section>
  )
}
