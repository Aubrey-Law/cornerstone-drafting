'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { DesignSheetOnChange } from './shared'
import { DesignSectionContent, SectionBlock } from './shared'
import { ExcludedGuardians } from './ExcludedGuardiansSection'
import { findClientContact, findSpouseContact, isMarriedSheet, type FiduciarySlotField } from './fiduciary-blocks'
import { FiduciaryGrid } from './FiduciaryGrid'

interface LpData {
  li_plan_coverage: string
  li_design_sheet_data: Record<string, unknown>
  li_design_sheet_approved: boolean
}

function splitInlineName(name: string): Pick<MatterContact, 'first_name' | 'middle_name' | 'last_name'> {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) {
    return {
      first_name: parts[0] ?? '',
      middle_name: null,
      last_name: '',
    }
  }

  return {
    first_name: parts[0] ?? '',
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : null,
    last_name: parts[parts.length - 1] ?? '',
  }
}

function contactName(contact: MatterContact): string {
  return [contact.first_name, contact.middle_name, contact.last_name, contact.suffix]
    .filter(Boolean)
    .join(' ')
}

export interface FiduciariesSectionProps {
  isLP: boolean
  // EP
  sheet: DesignSheet
  onChange: DesignSheetOnChange
  // LP
  lpData: LpData | null
  onLpChange: (key: string, value: unknown) => void
  // Shared
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  showInapplicable?: boolean
  /** Slot field a readiness blocker points at; flashes that grid column. */
  flashRoleKey?: FiduciarySlotField | null
}

export default function FiduciariesSection({
  sheet,
  contacts,
  matter,
  onChange,
  onAddContact,
  onUpdateContact,
  showInapplicable = false,
  flashRoleKey = null,
}: FiduciariesSectionProps) {
  const [newName, setNewName] = useState('')
  const [newRelationship, setNewRelationship] = useState('')
  const [adding, setAdding] = useState(false)

  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = isMarriedSheet(sheet) ? findSpouseContact(contacts, matter, sheet) : null

  const listedContacts = (() => {
    const all: MatterContact[] = [...contacts]
    if (clientContact) all.push(clientContact)
    if (spouseContact) all.push(spouseContact)
    return all.filter((contact, index, allContacts) => (
      Boolean(contact.id) && allContacts.findIndex(candidate => candidate.id === contact.id) === index
    ))
  })()

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
    <DesignSectionContent>
      <SectionBlock
        title="Fiduciary assignments"
        subtitle="Set the order in which each person serves across every document."
      >
        <div className="mb-4 space-y-3 rounded-lg border border-border bg-muted p-3">
          <div>
            <p className="text-sm font-semibold text-foreground">People in this matter</p>
            <p className="mt-1 text-xs text-muted-foreground">Only these people can be selected as fiduciaries below.</p>
          </div>
          {listedContacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No people are listed yet. Add one first.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {listedContacts.map(contact => (
                <div key={contact.id} className="rounded-lg border border-border bg-card p-2">
                  <p className="truncate text-sm font-medium text-foreground">{contactName(contact)}</p>
                  <p className="truncate text-micro text-muted-foreground">{contact.relationship || 'Contact'}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_auto]">
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

        <FiduciaryGrid
          sheet={sheet}
          contacts={contacts}
          matter={matter}
          onChange={onChange}
          showInapplicable={showInapplicable}
          flashRoleKey={flashRoleKey}
        />
      </SectionBlock>
      <ExcludedGuardians
        sheet={sheet}
        onChange={onChange}
        contacts={contacts}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
      />
    </DesignSectionContent>
  )
}
