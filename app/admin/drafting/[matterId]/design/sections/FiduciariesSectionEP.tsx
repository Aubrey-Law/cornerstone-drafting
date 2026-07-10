'use client'

import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet, FiduciarySlot, MatterContact, PipelineMatter } from '@/types/database'
import { AttorneyNoteBanner, DesignSectionContent, SectionBlock } from './shared'
import type { SectionProps } from './shared'
import {
  findClientContact,
  findSpouseContact,
  isMarriedSheet,
  partyFullName,
  PartyTabs,
  primaryContactId,
  resolveSlotContactIds,
  setPrimaryContact,
} from './fiduciary-blocks'

interface Props extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

type PrimaryRole = 'executor' | 'hcp' | 'poa'
type Party = 'client' | 'spouse'

const ROLE_LABELS: Record<PrimaryRole, string> = {
  executor: 'Personal Representative',
  hcp: 'Health Care Agent',
  poa: 'Financial POA Agent',
}

const CLIENT_SLOT_FIELDS: Record<PrimaryRole, keyof DesignSheet> = {
  executor: 'executor_slots',
  hcp: 'hcp_slots',
  poa: 'poa_slots',
}

const SPOUSE_SLOT_FIELDS: Record<PrimaryRole, keyof DesignSheet> = {
  executor: 'spouse_executor_slots',
  hcp: 'spouse_hcp_slots',
  poa: 'spouse_poa_slots',
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

function RoleShortcuts({
  roles,
  slotFields,
  sheet,
  onChange,
  primaryOptions,
  clientContact,
  spouseContact,
}: {
  roles: PrimaryRole[]
  slotFields: Record<PrimaryRole, keyof DesignSheet>
  sheet: DesignSheet
  onChange: Props['onChange']
  primaryOptions: { contact: MatterContact; label: string }[]
  clientContact: MatterContact | null
  spouseContact: MatterContact | null
}) {
  const setPrimary = (role: PrimaryRole, contact: MatterContact | null, checked: boolean) => {
    const field = slotFields[role]
    onChange(field, prevSheet => {
      const slots = (prevSheet[field] as FiduciarySlot[] | null) ?? []
      const resolved = resolveSlotContactIds(slots, clientContact, spouseContact)
      if (checked && contact) {
        return setPrimaryContact(resolved, contact.id) as DesignSheet[typeof field]
      }
      if (contact && primaryContactId(resolved) === contact.id) {
        return setPrimaryContact(resolved, null) as DesignSheet[typeof field]
      }
      return resolved as DesignSheet[typeof field]
    })
  }

  return (
    <div className="space-y-4">
      {roles.map(role => {
        const field = slotFields[role]
        const slots = (sheet[field] as FiduciarySlot[] | null) ?? []
        const primaryId = primaryContactId(slots)
        const roleLabel = ROLE_LABELS[role]

        return (
          <div key={role} className="space-y-2">
            <p className="text-sm font-medium text-foreground">{roleLabel}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {primaryOptions.map(opt => (
                <PrimaryShortcutRow
                  key={opt.contact.id}
                  label={opt.label.replace('{role}', roleLabel.toLowerCase())}
                  checked={primaryId === opt.contact.id}
                  onCheckedChange={checked => setPrimary(role, opt.contact, checked)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FiduciariesSectionEP({ sheet, onChange, contacts, matter }: Props) {
  const inclusions = getDocumentInclusions(sheet)
  const married = isMarriedSheet(sheet)
  const spouseDocs = married && inclusions.spouse_docs
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = married ? findSpouseContact(contacts, matter, sheet) : null
  const clientName = partyFullName(sheet, matter, 'client')
  const spouseName = partyFullName(sheet, matter, 'spouse')
  const clientFirst = clientName.split(/\s+/)[0] || 'Client'
  const spouseFirst = spouseName.split(/\s+/)[0] || 'Spouse'
  const [activeTab, setActiveTab] = useState<Party>('client')

  const roles: PrimaryRole[] = [
    ...(inclusions.will ? ['executor' as const] : []),
    ...(inclusions.healthcare ? ['hcp' as const] : []),
    ...(inclusions.dpoa ? ['poa' as const] : []),
  ]

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

  const clientOptions = [
    ...(clientContact
      ? [{ contact: clientContact, label: `${clientFirst} as initial {role}` }]
      : []),
    ...(spouseContact
      ? [{ contact: spouseContact, label: `${spouseFirst} as initial {role}` }]
      : []),
  ]

  const spouseOptions = [
    ...(spouseContact
      ? [{ contact: spouseContact, label: `${spouseFirst} as initial {role}` }]
      : []),
    ...(clientContact
      ? [{ contact: clientContact, label: `${clientFirst} as initial {role}` }]
      : []),
  ]

  const showTabs = married && spouseDocs
  const party: Party = showTabs ? activeTab : 'client'

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Use the shortcuts below to name the client or spouse as initial for key roles. Detailed successor
        nominations remain on the Trust, Will, Financial POA, and Health Care sections.
      </AttorneyNoteBanner>

      {showTabs && (
        <PartyTabs
          value={activeTab}
          onChange={setActiveTab}
          clientLabel={clientName}
          spouseLabel={spouseName}
        />
      )}

      <SectionBlock
        title={
          showTabs
            ? `${party === 'client' ? clientName : spouseName} — Primary Fiduciary Shortcuts`
            : 'Primary Fiduciary Shortcuts'
        }
      >
        <RoleShortcuts
          roles={roles}
          slotFields={party === 'spouse' ? SPOUSE_SLOT_FIELDS : CLIENT_SLOT_FIELDS}
          sheet={sheet}
          onChange={onChange}
          primaryOptions={party === 'spouse' ? spouseOptions : clientOptions}
          clientContact={clientContact}
          spouseContact={spouseContact}
        />
      </SectionBlock>
    </DesignSectionContent>
  )
}
