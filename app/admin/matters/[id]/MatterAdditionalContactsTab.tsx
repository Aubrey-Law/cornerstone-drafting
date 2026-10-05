'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Badge } from '@/components/ui/badge'
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
import {
  contactProfileRelationshipPatch,
  relationshipLabelForContact,
  relationshipSelectionToStructured,
} from '@/lib/kinship/relationshipLabels'
import { appointedFiduciaryRolesByContact } from '@/lib/matter/planMirror'
import { contactFullName } from '@/app/admin/drafting/[matterId]/design/sections/ContactPicker'
import type { PersonFormValues } from '@/app/admin/drafting/[matterId]/design/sections/AddPersonDialog'
import type { PersonAddRequest } from './MatterPeopleTab'
import { useConfirm } from '@/components/useConfirm'

const AddPersonDialog = dynamic(
  () => import('@/app/admin/drafting/[matterId]/design/sections/AddPersonDialog').then(m => ({ default: m.AddPersonDialog })),
  { ssr: false },
)

interface Props {
  matterId: string
  matter: PipelineMatter
  initialContacts: MatterContact[]
  embedded?: boolean
  addRequest?: PersonAddRequest | null
}

export function MatterAdditionalContactsTab({
  matterId,
  matter,
  initialContacts,
  embedded = false,
  addRequest,
}: Props) {
  const { confirm, confirmDialog } = useConfirm()
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
        // Family, above, already lists the client, spouse and children; this
        // list is everyone else. Leaving `self` in put the client under
        // "Other contacts" a second time, tagged "(self)".
        const rows = (json.contacts ?? []).filter(
          c => c.relationship_type !== 'self' && c.relationship_type !== 'spouse' && c.relationship_type !== 'child',
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
  useEffect(() => {
    if (addRequest?.kind === 'fiduciary') setAddFiduciaryOpen(true)
    if (addRequest?.kind === 'beneficiary') setAddBeneficiaryOpen(true)
  }, [addRequest?.kind, addRequest?.nonce])

  const profiles = useMemo(() => (sheet ? getContactProfiles(sheet) : {}), [sheet])
  const unresolvedSlots = useMemo(
    () => Object.entries(sheet?.fiduciary_slot_states ?? {})
      .filter(([, state]) => state === 'pending_client' || state === 'optional'),
    [sheet?.fiduciary_slot_states],
  )

  // Contacts the design sheet appointed to a fiduciary slot count as
  // fiduciaries even though nothing ever set their contact-profile flag —
  // the fiduciary grid writes slot arrays, not profiles.
  const appointedRoles = useMemo(() => appointedFiduciaryRolesByContact(sheet), [sheet])

  const fiduciaryContacts = useMemo(() => {
    return contacts.filter(c => {
      if (appointedRoles.has(c.id)) return true
      const profile = profiles[c.id]
      if (profile?.is_beneficiary && !profile?.is_fiduciary) return false
      if (profile?.is_fiduciary) return true
      return profile?.is_fiduciary !== false && (c.relationship?.toLowerCase().includes('trustee') || false)
    })
  }, [contacts, profiles, appointedRoles])

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
        sheetId: nextSheet.id,
        expectedUpdatedAt: nextSheet.updated_at,
        sheet: {
          decisions: nextSheet.decisions,
        },
      }),
    })
    const body = await res.json().catch(() => ({})) as {
      error?: string
      id?: string
      updated_at?: string
    }
    if (!res.ok) throw new Error(body.error ?? 'Failed to save contact profile')
    setSheet({
      ...nextSheet,
      id: typeof body.id === 'string' ? body.id : nextSheet.id,
      updated_at: typeof body.updated_at === 'string' ? body.updated_at : nextSheet.updated_at,
    })
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
    const structured = relationshipSelectionToStructured(
      values.relationship_selection,
      values.relationship_custom,
    )
    const relationshipPatch = contactProfileRelationshipPatch(structured, 'client')

    const payload: Omit<MatterContact, 'id'> = {
      first_name: values.first_name.trim(),
      last_name: values.last_name.trim(),
      middle_name: values.middle_name?.trim() || undefined,
      preferred_pronoun: values.gender?.trim() || undefined,
      phone: values.phone?.trim() || undefined,
      email: values.email?.trim() || undefined,
      address: values.address?.trim() || undefined,
      relationship: relationshipLabelForContact(structured),
      date_of_birth: values.date_of_birth || null,
    }

    const contact = await saveContact(payload, existingId)
    if (!sheet) return contact

    const profilePatch: Partial<ContactProfile> = {
      is_fiduciary: mode === 'fiduciary' ? true : Boolean(values.also_fiduciary),
      is_beneficiary: mode === 'beneficiary' ? true : Boolean(values.also_beneficiary),
      fiduciary_type: values.fiduciary_type,
      beneficiary_type: values.beneficiary_type,
      date_of_birth: values.date_of_birth || null,
      ...relationshipPatch,
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
    if (!(await confirm({
      title: `Remove ${label} from this matter?`,
      body: 'The person stays in your contacts; only their role on this matter is removed.',
      confirmLabel: 'Remove',
      destructive: true,
    }))) return
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
      {confirmDialog}
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Additional contacts</h3>
            <p className="text-xs text-muted-foreground">
              Fiduciaries, beneficiaries, and other contacts. Import from text or upload a document.
            </p>
          </div>
          <FiduciaryContactTools onSubmit={handleAddContacts} />
        </div>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <div>
            <h3 className="text-sm font-semibold">Additional contacts</h3>
            <p className="text-xs text-muted-foreground">
              Fiduciaries, beneficiaries, and other contacts. Import from text or upload a document.
            </p>
          </div>
          <FiduciaryContactTools onSubmit={handleAddContacts} />
        </div>
      )}

      {unresolvedSlots.length > 0 && (
        <section aria-labelledby="unresolved-role-heading" className="space-y-2">
          <h4 id="unresolved-role-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Unresolved roles
          </h4>
          <div className="divide-y rounded-lg border bg-card">
            {unresolvedSlots.map(([slot, state]) => (
              <div key={slot} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-sm font-medium">
                  {slot.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())}
                </span>
                <Badge variant="outline">{state === 'pending_client' ? 'Pending client' : 'Optional'}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Two empty headings, each saying "none yet", read as more missing than
          there is; one line covers both until either list has someone. */}
      {fiduciaryContacts.length === 0 && beneficiaryContacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No fiduciaries or beneficiaries added yet.</p>
      ) : (<>
      <section id="fiduciaries" className="scroll-mt-24 space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fiduciaries</h4>
        {fiduciaryContacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No fiduciaries added yet.</p>
        ) : (
          <PersonContactCardGrid>
            {fiduciaryContacts.map(contact => {
              const profile = profiles[contact.id]
              const type = profile?.fiduciary_type
                ? FIDUCIARY_TYPE_LABELS[profile.fiduciary_type]
                : appointedRoles.get(contact.id)?.join(', ')
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
      </section>

      <section id="beneficiaries" className="scroll-mt-24 space-y-3">
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
      </section>
      </>)}

      {otherContacts.length > 0 && (
        <section id="other-contacts" className="scroll-mt-24 space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other contacts</h4>
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
