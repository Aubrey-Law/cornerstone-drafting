'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { PersonContactCard, PersonContactCardGrid } from '@/components/matter/PersonContactCard'
import { FiduciaryContactTools, type FiduciaryContactInput } from '@/components/admin/FiduciaryContactTools'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import {
  BENEFICIARY_TYPE_LABELS,
  FIDUCIARY_TYPE_LABELS,
  getContactProfiles,
  removeContactProfile,
  setContactProfile,
  type ContactProfile,
} from '@/lib/designSheet/fiduciaryDocumentInclusions'
import { contactFullName } from '@/app/admin/drafting/[matterId]/design/sections/ContactPicker'
import type { PersonFormValues } from '@/app/admin/drafting/[matterId]/design/sections/AddPersonDialog'

const AddPersonDialog = dynamic(
  () => import('@/app/admin/drafting/[matterId]/design/sections/AddPersonDialog').then(m => ({ default: m.AddPersonDialog })),
  { ssr: false },
)

interface Props {
  matterId: string
  matter: PipelineMatter
  initialContacts: MatterContact[]
}

export function MatterAdditionalContactsTab({ matterId, matter, initialContacts }: Props) {
  const token = useAccessToken()
  const [contacts, setContacts] = useState(initialContacts)
  const [sheet, setSheet] = useState<DesignSheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [addFiduciaryOpen, setAddFiduciaryOpen] = useState(false)
  const [addBeneficiaryOpen, setAddBeneficiaryOpen] = useState(false)
  const [editing, setEditing] = useState<{ contact: MatterContact; mode: 'fiduciary' | 'beneficiary' } | null>(null)

  const loadData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [contactsRes, sheetRes] = await Promise.all([
        fetch(`/api/admin/matters/${matterId}/contacts`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/admin/matters/${matterId}/design-sheet`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (contactsRes.ok) {
        const json = await contactsRes.json() as { contacts: Array<Record<string, unknown>> }
        const rows = (json.contacts ?? []).filter(
          c => c.relationship_type !== 'spouse' && c.relationship_type !== 'child',
        )
        setContacts(rows.map(c => ({
          id: c.id as string,
          first_name: (c.first_name as string) ?? '',
          middle_name: (c.middle_name as string) ?? null,
          last_name: (c.last_name as string) ?? '',
          email: (c.email as string) ?? null,
          phone: (c.phone as string) ?? null,
          address: (c.address_line1 as string) ?? null,
          date_of_birth: (c.date_of_birth as string) ?? null,
          relationship: (c.relationship_label as string) ?? (c.relationship_type as string) ?? null,
        })))
      }
      if (sheetRes.ok) {
        const json = await sheetRes.json()
        setSheet(json.sheet as DesignSheet)
      }
    } catch {
      toast.error('Failed to load additional contacts')
    } finally {
      setLoading(false)
    }
  }, [matterId, token])

  useEffect(() => { void loadData() }, [loadData])
  useEffect(() => { setContacts(initialContacts) }, [initialContacts])

  const profiles = useMemo(() => (sheet ? getContactProfiles(sheet) : {}), [sheet])

  const fiduciaryContacts = useMemo(() => {
    return contacts.filter(c => {
      const profile = profiles[c.id]
      if (profile?.is_beneficiary && !profile?.is_fiduciary) return false
      if (profile?.is_fiduciary) return true
      return profile?.is_fiduciary !== false && (c.relationship?.toLowerCase().includes('trustee') || false)
    })
  }, [contacts, profiles])

  const beneficiaryContacts = useMemo(() => {
    return contacts.filter(c => profiles[c.id]?.is_beneficiary)
  }, [contacts, profiles])

  const otherContacts = useMemo(() => {
    const shown = new Set([...fiduciaryContacts, ...beneficiaryContacts].map(c => c.id))
    return contacts.filter(c => !shown.has(c.id))
  }, [contacts, fiduciaryContacts, beneficiaryContacts])

  const saveSheetProfiles = async (nextSheet: DesignSheet) => {
    if (!token || !nextSheet.id) return
    const res = await fetch(`/api/admin/matters/${matterId}/design-sheet`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: nextSheet.id,
        updated_at: nextSheet.updated_at,
        decisions: nextSheet.decisions,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to save contact profile')
    if (body.sheet) setSheet(body.sheet as DesignSheet)
  }

  const handleAddContacts = async (inputs: FiduciaryContactInput[]) => {
    if (!token) throw new Error('Not signed in')
    const res = await fetch(`/api/admin/matters/${matterId}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contacts: inputs }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Failed to save contacts')
    await loadData()
  }

  const saveContact = async (payload: Omit<MatterContact, 'id'>, existingId?: string) => {
    if (!token) throw new Error('Not signed in')
    const res = await fetch(`/api/admin/matters/${matterId}/design-sheet/contacts`, {
      method: existingId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: existingId, ...payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? 'Failed to save contact')
    return body.contact as MatterContact
  }

  const savePerson = async (
    values: PersonFormValues,
    mode: 'fiduciary' | 'beneficiary',
    existingId?: string,
  ) => {
    const payload: Omit<MatterContact, 'id'> = {
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      middle_name: values.middle_name?.trim() || undefined,
      preferred_pronoun: values.gender?.trim() || undefined,
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
      address: values.address?.trim() || undefined,
      relationship: values.relationship_detail?.trim() || values.relationship_to || undefined,
      date_of_birth: values.date_of_birth || null,
    }

    const contact = await saveContact(payload, existingId)
    if (!sheet) return contact

    const profilePatch: Partial<ContactProfile> = {
      is_fiduciary: mode === 'fiduciary' ? true : Boolean(values.also_fiduciary),
      is_beneficiary: mode === 'beneficiary' ? true : Boolean(values.also_beneficiary),
      fiduciary_type: values.fiduciary_type,
      beneficiary_type: values.beneficiary_type,
      relationship_to: values.relationship_to,
      relationship_detail: values.relationship_detail,
      date_of_birth: values.date_of_birth || null,
    }
    const nextSheet = {
      ...sheet,
      decisions: setContactProfile(sheet, contact.id, profilePatch),
    }
    await saveSheetProfiles(nextSheet)
    setContacts(current => {
      if (existingId) return current.map(c => (c.id === contact.id ? contact : c))
      return [...current, contact]
    })
    return contact
  }

  const handleDeleteContact = async (contact: MatterContact) => {
    const label = contactFullName(contact)
    if (!window.confirm(`Remove ${label} from this matter?`)) return
    if (!token) return
    try {
      const res = await fetch(
        `/api/admin/matters/${matterId}/design-sheet/contacts?contactId=${encodeURIComponent(contact.id)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to remove contact')
      if (sheet) {
        const nextSheet = { ...sheet, decisions: removeContactProfile(sheet, contact.id) }
        await saveSheetProfiles(nextSheet)
      }
      setContacts(current => current.filter(c => c.id !== contact.id))
      toast.success('Contact removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove contact')
    }
  }

  const clientName = matter.client_name?.trim() || 'Client'
  const spouseName = matter.spouse_name?.trim() || 'Spouse'

  if (loading && !sheet) {
    return <p className="text-xs text-muted-foreground">Loading additional contacts…</p>
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Additional Contacts</h3>
          <p className="text-xs text-muted-foreground">
            Fiduciaries, beneficiaries, and other contacts. Import from text or upload a document.
          </p>
        </div>
        <FiduciaryContactTools onSubmit={handleAddContacts} />
      </div>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fiduciaries</h4>
        {fiduciaryContacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No fiduciaries added yet.</p>
        ) : (
          <PersonContactCardGrid>
            {fiduciaryContacts.map(contact => {
              const profile = profiles[contact.id]
              const type = profile?.fiduciary_type ? FIDUCIARY_TYPE_LABELS[profile.fiduciary_type] : undefined
              return (
                <PersonContactCard
                  key={contact.id}
                  contact={contact}
                  profile={profile}
                  typeLabel={type}
                  showAlsoAsBeneficiary={Boolean(profile?.is_beneficiary)}
                  onEdit={() => setEditing({ contact, mode: 'fiduciary' })}
                  onDelete={() => void handleDeleteContact(contact)}
                />
              )
            })}
          </PersonContactCardGrid>
        )}
        <Button type="button" size="sm" className="gap-1.5" onClick={() => setAddFiduciaryOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add Fiduciary
        </Button>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Beneficiaries</h4>
        {beneficiaryContacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No beneficiaries added yet.</p>
        ) : (
          <PersonContactCardGrid>
            {beneficiaryContacts.map(contact => {
              const profile = profiles[contact.id]
              const type = profile?.beneficiary_type ? BENEFICIARY_TYPE_LABELS[profile.beneficiary_type] : undefined
              return (
                <PersonContactCard
                  key={contact.id}
                  contact={contact}
                  profile={profile}
                  typeLabel={type}
                  onEdit={() => setEditing({ contact, mode: 'beneficiary' })}
                  onDelete={() => void handleDeleteContact(contact)}
                />
              )
            })}
          </PersonContactCardGrid>
        )}
        <Button type="button" size="sm" className="gap-1.5" onClick={() => setAddBeneficiaryOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add Beneficiary
        </Button>
      </section>

      {otherContacts.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other Contacts</h4>
          <PersonContactCardGrid>
            {otherContacts.map(contact => (
              <PersonContactCard
                key={contact.id}
                contact={contact}
                onEdit={() => setEditing({ contact, mode: 'fiduciary' })}
                onDelete={() => void handleDeleteContact(contact)}
              />
            ))}
          </PersonContactCardGrid>
        </section>
      )}

      <AddPersonDialog
        open={addFiduciaryOpen}
        onOpenChange={setAddFiduciaryOpen}
        mode="fiduciary"
        clientName={clientName}
        spouseName={spouseName}
        title="Add Fiduciary"
        subtitle="Enter the fiduciary details below."
        onSave={async values => { await savePerson(values, 'fiduciary') }}
      />

      <AddPersonDialog
        open={addBeneficiaryOpen}
        onOpenChange={setAddBeneficiaryOpen}
        mode="beneficiary"
        clientName={clientName}
        spouseName={spouseName}
        title="Add Beneficiary"
        subtitle="Enter the beneficiary details below."
        onSave={async values => { await savePerson(values, 'beneficiary') }}
      />

      {editing && (
        <AddPersonDialog
          open
          onOpenChange={open => { if (!open) setEditing(null) }}
          mode={editing.mode}
          clientName={clientName}
          spouseName={spouseName}
          title={editing.mode === 'fiduciary' ? 'Edit Fiduciary' : 'Edit Beneficiary'}
          subtitle="Update contact details below."
          initialContact={editing.contact}
          initialProfile={profiles[editing.contact.id]}
          onSave={async values => {
            await savePerson(values, editing.mode, editing.contact.id)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
