'use client'

import { useState } from 'react'
import { ArrowLeftRight, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { designPlanTypeIncludesTrust } from '@/lib/designPlanType'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import { designFieldTargetId } from '@/lib/designSheetReadiness'
import { cn } from '@/lib/utils'
import type { DesignSheet, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'
import {
  CLIENT_SLOT_FIELDS,
  SPOUSE_SLOT_FIELDS,
  cloneSlots,
  findClientContact,
  findSpouseContact,
  isMarriedSheet,
  partyFullName,
  PartyTabs,
  resolveSlotContactIds,
  setPrimaryContact,
  type FiduciaryGridRole,
  type FiduciarySlotField,
} from './fiduciary-blocks'
import { createSlot, normalizeFiduciarySlots } from './fiduciary-helpers'
import type { DesignSheetOnChange } from './shared'

const GRID_ROLES: Array<{
  id: FiduciaryGridRole
  label: string
  document: string
}> = [
  { id: 'trustee', label: 'Successor trustee', document: 'Trust' },
  { id: 'executor', label: 'Personal representative', document: 'Will' },
  { id: 'poa', label: 'Financial POA agent', document: 'Durable POA' },
  { id: 'hcp', label: 'Health care agent', document: 'HCP' },
  { id: 'guardian', label: 'Guardian', document: 'Will / appointment' },
]

function namedPrincipals(slots: FiduciarySlot[]): FiduciarySlot[] {
  return normalizeFiduciarySlots(slots)
    .filter(slot => !slot.is_co && Boolean(slot.contact_id))
    .sort((a, b) => a.order - b.order)
}

export function toggleFiduciaryGridContact(
  slots: FiduciarySlot[] | null | undefined,
  contactId: string,
): FiduciarySlot[] {
  const normalized = normalizeFiduciarySlots(slots ?? [])
  const existing = normalized.find(slot => !slot.is_co && slot.contact_id === contactId)

  if (!existing) {
    const named = namedPrincipals(normalized)
    if (named.length === 0) {
      return normalizeFiduciarySlots(setPrimaryContact(normalized, contactId))
    }
    const nextOrder = Math.max(...normalized.map(slot => slot.order), -1) + 1
    return normalizeFiduciarySlots([
      ...normalized,
      { ...createSlot(nextOrder), contact_id: contactId },
    ])
  }

  const removedOrder = existing.order
  const compacted = normalized
    .filter(slot => slot.order !== removedOrder)
    .map(slot => slot.order > removedOrder ? { ...slot, order: slot.order - 1 } : slot)
  const nextPrimaryId = namedPrincipals(compacted)[0]?.contact_id ?? null
  return normalizeFiduciarySlots(setPrimaryContact(compacted, nextPrimaryId))
}

export function mirrorReversedFiduciarySlots(
  slots: FiduciarySlot[] | null | undefined,
  clientContactId: string | null,
  spouseContactId: string | null,
): FiduciarySlot[] {
  const mirrored = cloneSlots(slots).map(slot => {
    if (clientContactId && slot.contact_id === clientContactId) {
      return { ...slot, contact_id: spouseContactId }
    }
    if (spouseContactId && slot.contact_id === spouseContactId) {
      return { ...slot, contact_id: clientContactId }
    }
    return slot
  })
  return normalizeFiduciarySlots(mirrored)
}

function splitInlineName(name: string): Pick<MatterContact, 'first_name' | 'last_name'> {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    first_name: parts[0] ?? '',
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '',
  }
}

function contactName(contact: MatterContact): string {
  return [contact.first_name, contact.middle_name, contact.last_name, contact.suffix]
    .filter(Boolean)
    .join(' ')
}

export function FiduciaryGrid({
  sheet,
  contacts,
  matter,
  onChange,
  onAddContact,
  showInapplicable = false,
}: {
  sheet: DesignSheet
  contacts: MatterContact[]
  matter: PipelineMatter
  onChange: DesignSheetOnChange
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  showInapplicable?: boolean
}) {
  const married = isMarriedSheet(sheet)
  const [party, setParty] = useState<'client' | 'spouse'>('client')
  const [newName, setNewName] = useState('')
  const [newRelationship, setNewRelationship] = useState('')
  const [adding, setAdding] = useState(false)
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = married ? findSpouseContact(contacts, matter, sheet) : null
  const slotFields = party === 'spouse' ? SPOUSE_SLOT_FIELDS : CLIENT_SLOT_FIELDS
  const inclusions = getDocumentInclusions(sheet)
  const requiredRoles = new Set<FiduciaryGridRole>([
    ...(inclusions.trust ? ['trustee' as const] : []),
    ...(inclusions.will ? ['executor' as const] : []),
    ...(inclusions.dpoa ? ['poa' as const] : []),
    ...(inclusions.healthcare ? ['hcp' as const] : []),
    ...(inclusions.will && sheetHasMinorChildren(sheet.children) ? ['guardian' as const] : []),
  ])
  const displayedRoles = GRID_ROLES
    .map(role => ({
      ...role,
      applicable: role.id !== 'trustee' || designPlanTypeIncludesTrust(sheet.plan_type),
    }))
    .filter(role => showInapplicable || role.applicable)

  const syntheticContacts = [clientContact, spouseContact].filter(
    (contact): contact is MatterContact => Boolean(contact),
  )
  const roster = [...syntheticContacts, ...contacts]
    .filter((contact, index, all) => (
      Boolean(contact.id)
      && all.findIndex(candidate => candidate.id === contact.id) === index
      && contact.id !== (party === 'client' ? clientContact?.id : spouseContact?.id)
    ))

  const writeSlots = (field: FiduciarySlotField, updater: (slots: FiduciarySlot[]) => FiduciarySlot[]) => {
    onChange(field, previousSheet => {
      const current = (previousSheet[field] as FiduciarySlot[] | null) ?? []
      const resolved = resolveSlotContactIds(current, clientContact, spouseContact)
      return normalizeFiduciarySlots(updater(resolved)) as DesignSheet[typeof field]
    })
  }

  const mirrorToOtherParty = () => {
    const targetFields = party === 'client' ? SPOUSE_SLOT_FIELDS : CLIENT_SLOT_FIELDS
    for (const role of GRID_ROLES) {
      const sourceField = slotFields[role.id]
      const targetField = targetFields[role.id]
      if (sourceField === targetField) continue
      const source = (sheet[sourceField] as FiduciarySlot[] | null) ?? []
      onChange(targetField, mirrorReversedFiduciarySlots(
        resolveSlotContactIds(source, clientContact, spouseContact),
        clientContact?.id ?? null,
        spouseContact?.id ?? null,
      ) as DesignSheet[typeof targetField])
    }
    setParty(current => current === 'client' ? 'spouse' : 'client')
  }

  const addPerson = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      await onAddContact({
        ...splitInlineName(newName),
        relationship: newRelationship.trim() || null,
      })
      setNewName('')
      setNewRelationship('')
      toast.success('Person added')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add person')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      {married ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[320px] flex-1">
            <PartyTabs
              value={party}
              onChange={setParty}
              clientLabel={partyFullName(sheet, matter, 'client')}
              spouseLabel={partyFullName(sheet, matter, 'spouse')}
            />
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={mirrorToOtherParty}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Mirror reversed
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[#e5e7eb]">
        <div
          className="grid min-w-[648px]"
          style={{
            gridTemplateColumns: displayedRoles.length === 5
              ? '168px repeat(5, minmax(96px, 1fr))'
              : `168px repeat(${displayedRoles.length}, minmax(96px, 1fr))`,
          }}
        >
          <div className="border-b border-r border-[#e5e7eb] bg-muted/40 p-3 text-xs font-semibold text-[#1f2d5a]">
            Contact roster
          </div>
          {displayedRoles.map(role => {
            const slots = (sheet[slotFields[role.id]] as FiduciarySlot[] | null) ?? []
            const count = namedPrincipals(slots).length
            const required = requiredRoles.has(role.id)
            const status = count === 0 ? 'Not named' : count === 1 ? 'No alternate' : `${count} in line`
            return (
              <div
                key={role.id}
                id={designFieldTargetId(String(slotFields[role.id]))}
                tabIndex={-1}
                className={cn(
                  'border-b border-r border-[#e5e7eb] bg-muted/40 p-2 last:border-r-0',
                  !role.applicable && 'opacity-45 grayscale-[20%]',
                )}
              >
                <p className="text-[11px] font-semibold leading-tight text-[#1f2d5a]">{role.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{role.document}</p>
                <span className={cn(
                  'mt-2 inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                  count === 0 && required
                    ? 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e]'
                    : count === 1
                      ? 'border-[#e5e7eb] bg-white text-muted-foreground'
                      : 'border-teal-200 bg-teal-50 text-[#1a6b72]',
                )}>
                  {status}
                </span>
              </div>
            )
          })}

          {roster.map(contact => (
            <div key={contact.id} className="contents">
              <div className="border-b border-r border-[#e5e7eb] p-3">
                <p className="truncate text-xs font-medium text-foreground">{contactName(contact)}</p>
                <p className="truncate text-[10px] text-muted-foreground">{contact.relationship || 'Contact'}</p>
              </div>
              {displayedRoles.map(role => {
                const field = slotFields[role.id]
                const slots = (sheet[field] as FiduciarySlot[] | null) ?? []
                const order = namedPrincipals(slots).findIndex(slot => slot.contact_id === contact.id)
                const selected = order >= 0
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-label={`${selected ? 'Remove' : 'Add'} ${contactName(contact)} ${role.label}`}
                    aria-pressed={selected}
                    onClick={() => writeSlots(field, current => toggleFiduciaryGridContact(current, contact.id))}
                    className={cn(
                      'flex min-h-14 items-center justify-center border-b border-r border-[#e5e7eb] p-2 last:border-r-0',
                      selected ? 'bg-teal-50 text-[#1a6b72]' : 'bg-white text-muted-foreground hover:bg-muted/40',
                      !role.applicable && 'opacity-45 grayscale-[20%]',
                    )}
                  >
                    {selected ? (
                      <span className="rounded-full border border-[#1a6b72] px-2 py-1 text-[11px] font-semibold">
                        {order + 1}{order === 0 ? 'st' : order === 1 ? 'nd' : order === 2 ? 'rd' : 'th'}
                      </span>
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}

          <div
            className="grid grid-cols-1 gap-2 bg-muted/20 p-3 sm:grid-cols-[1fr_1fr_auto]"
            style={{ gridColumn: `span ${displayedRoles.length + 1} / span ${displayedRoles.length + 1}` }}
          >
            <Input
              value={newName}
              onChange={event => setNewName(event.target.value)}
              placeholder="Full name"
              aria-label="New person full name"
            />
            <Input
              value={newRelationship}
              onChange={event => setNewRelationship(event.target.value)}
              placeholder="Relationship"
              aria-label="New person relationship"
            />
            <Button type="button" variant="outline" onClick={() => void addPerson()} disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Add person
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
