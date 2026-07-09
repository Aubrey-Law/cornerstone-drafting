'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'
import { AttorneyNoteBanner, DesignSectionContent, SectionBlock } from './shared'
import type { SectionProps } from './shared'
import {
  cloneSlots,
  findClientContact,
  findSpouseContact,
  isMarriedSheet,
  primaryContactId,
  setPrimaryContact,
} from './fiduciary-blocks'

interface Props extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

type PrimaryRole = 'executor' | 'hcp' | 'poa'

const ROLE_LABELS: Record<PrimaryRole, string> = {
  executor: 'Personal Representative',
  hcp: 'Health Care Agent',
  poa: 'Financial POA Agent',
}

const SLOT_FIELDS: Record<PrimaryRole, keyof DesignSheet> = {
  executor: 'executor_slots',
  hcp: 'hcp_slots',
  poa: 'poa_slots',
}

function PrimaryShortcutRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <Checkbox checked={checked} onCheckedChange={value => onCheckedChange(value === true)} />
      <span className="text-xs text-foreground">{label}</span>
    </label>
  )
}

export function FiduciariesSectionEP({ sheet, onChange, contacts, matter }: Props) {
  const inclusions = getDocumentInclusions(sheet)
  const married = isMarriedSheet(sheet)
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = married ? findSpouseContact(contacts, matter, sheet) : null
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || 'Client'
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || 'Spouse'

  const roles: PrimaryRole[] = [
    ...(inclusions.will ? ['executor' as const] : []),
    ...(inclusions.healthcare ? ['hcp' as const] : []),
    ...(inclusions.dpoa ? ['poa' as const] : []),
  ]

  const setPrimary = (role: PrimaryRole, contact: MatterContact | null, checked: boolean) => {
    const field = SLOT_FIELDS[role]
    const slots = (sheet[field] as FiduciarySlot[] | null) ?? []
    onChange(
      field,
      (checked && contact
        ? setPrimaryContact(slots, contact.id)
        : contact && primaryContactId(slots) === contact.id
          ? setPrimaryContact(slots, null)
          : slots) as DesignSheet[typeof field],
    )
  }

  const copyTrusteesToRole = (role: PrimaryRole) => {
    const field = SLOT_FIELDS[role]
    if (role === 'executor') {
      onChange('executor_same_as_trustee', true)
      onChange('executor_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['executor_slots'])
      return
    }
    if (role === 'poa') {
      onChange('poa_same_as_trustee', true)
      onChange('poa_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['poa_slots'])
      return
    }
    onChange(field, cloneSlots(sheet.trustee_slots) as DesignSheet[typeof field])
  }

  if (roles.length === 0) {
    return (
      <DesignSectionContent>
        <AttorneyNoteBanner>
          Assign fiduciary roles on the Trust Details, Will Details, Financial Power of Attorney, and
          Health Care &amp; Directives sections below. Add contacts first in Contacts &amp; Fiduciaries.
        </AttorneyNoteBanner>
      </DesignSectionContent>
    )
  }

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Use the shortcuts below to name the client or spouse as primary for key roles. Detailed successor
        nominations remain on the Trust, Will, Financial POA, and Health Care sections.
      </AttorneyNoteBanner>

      <SectionBlock title="Primary Fiduciary Shortcuts">
        <div className="space-y-4">
          {roles.map(role => {
            const field = SLOT_FIELDS[role]
            const slots = (sheet[field] as FiduciarySlot[] | null) ?? []
            const primaryId = primaryContactId(slots)
            const roleLabel = ROLE_LABELS[role]

            return (
              <div key={role} className="space-y-2">
                <p className="text-sm font-medium text-foreground">{roleLabel}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {clientContact && (
                    <PrimaryShortcutRow
                      label={`${clientFirst} as primary ${roleLabel.toLowerCase()}`}
                      checked={primaryId === clientContact.id}
                      onCheckedChange={checked => setPrimary(role, clientContact, checked)}
                    />
                  )}
                  {spouseContact && (
                    <PrimaryShortcutRow
                      label={`${spouseFirst} as primary ${roleLabel.toLowerCase()}`}
                      checked={primaryId === spouseContact.id}
                      onCheckedChange={checked => setPrimary(role, spouseContact, checked)}
                    />
                  )}
                </div>
                {inclusions.trust && role !== 'hcp' && (
                  <button
                    type="button"
                    className="text-xs font-medium text-accent hover:text-accent/80"
                    onClick={() => copyTrusteesToRole(role)}
                  >
                    Copy trustees to {roleLabel.toLowerCase()} slots
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}
