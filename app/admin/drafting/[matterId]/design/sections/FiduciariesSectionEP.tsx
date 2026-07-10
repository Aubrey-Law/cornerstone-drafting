'use client'

import { useState } from 'react'
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
  partyFullName,
  PartyTabs,
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
  showCopyTrustees,
}: {
  roles: PrimaryRole[]
  slotFields: Record<PrimaryRole, keyof DesignSheet>
  sheet: DesignSheet
  onChange: Props['onChange']
  primaryOptions: { contact: MatterContact; label: string }[]
  showCopyTrustees: boolean
}) {
  const setPrimary = (role: PrimaryRole, contact: MatterContact | null, checked: boolean) => {
    const field = slotFields[role]
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
    const field = slotFields[role]
    if (role === 'executor' && field === 'executor_slots') {
      onChange('executor_same_as_trustee', true)
      onChange('executor_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['executor_slots'])
      return
    }
    if (role === 'poa' && field === 'poa_slots') {
      onChange('poa_same_as_trustee', true)
      onChange('poa_slots', cloneSlots(sheet.trustee_slots) as DesignSheet['poa_slots'])
      return
    }
    if (role === 'executor' && field === 'spouse_executor_slots') {
      onChange('spouse_executor_same_as_trustee', true)
      onChange(
        'spouse_executor_slots',
        cloneSlots(sheet.spouse_trustee_slots?.length ? sheet.spouse_trustee_slots : sheet.trustee_slots) as DesignSheet['spouse_executor_slots'],
      )
      return
    }
    if (role === 'poa' && field === 'spouse_poa_slots') {
      onChange('spouse_poa_same_as_trustee', true)
      onChange(
        'spouse_poa_slots',
        cloneSlots(sheet.spouse_trustee_slots?.length ? sheet.spouse_trustee_slots : sheet.trustee_slots) as DesignSheet['spouse_poa_slots'],
      )
      return
    }
    onChange(field, cloneSlots(sheet.trustee_slots) as DesignSheet[typeof field])
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
            {showCopyTrustees && role !== 'hcp' && (
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
      ? [{ contact: clientContact, label: `${clientFirst} as primary {role}` }]
      : []),
    ...(spouseContact
      ? [{ contact: spouseContact, label: `${spouseFirst} as primary {role}` }]
      : []),
  ]

  const spouseOptions = [
    ...(spouseContact
      ? [{ contact: spouseContact, label: `${spouseFirst} as primary {role}` }]
      : []),
    ...(clientContact
      ? [{ contact: clientContact, label: `${clientFirst} as primary {role}` }]
      : []),
  ]

  const showTabs = married && spouseDocs
  const party: Party = showTabs ? activeTab : 'client'

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Use the shortcuts below to name the client or spouse as primary for key roles. Detailed successor
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
          showCopyTrustees={inclusions.trust}
        />
      </SectionBlock>
    </DesignSectionContent>
  )
}
