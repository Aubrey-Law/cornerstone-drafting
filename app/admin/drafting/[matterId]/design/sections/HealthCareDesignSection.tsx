'use client'

import { useState } from 'react'
import { BookOpen, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import {
  anatomicalGiftToLegacy,
  getDesignSheetHealthcareProvisions,
  setDesignSheetHealthcareProvisions,
  type AdvanceDirectiveChoice,
  type AnatomicalGiftPreference,
} from '@/lib/designSheetHealthcareProvisions'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import { FiduciaryBlock, isMarriedSheet } from './fiduciary-blocks'
import type { SectionProps } from './shared'
import {
  DesignSheetCheckboxOption,
  FieldLabel,
  SectionBlock,
} from './shared'

interface HealthCareDesignSectionProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

function ClauseLibraryActions() {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
        <BookOpen className="h-3.5 w-3.5" />
        Clause Library
      </Button>
      <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
        <Sparkles className="h-3.5 w-3.5" />
        Draft with AI
      </Button>
    </div>
  )
}

function AnatomicalGiftBlock({
  title,
  preference,
  restrictions,
  onPreferenceChange,
  onRestrictionsChange,
}: {
  title: string
  preference: AnatomicalGiftPreference | null
  restrictions: string | null
  onPreferenceChange: (value: AnatomicalGiftPreference) => void
  onRestrictionsChange: (value: string | null) => void
}) {
  const [localRestrictions, setLocalRestrictions] = useState(restrictions ?? '')
  const [showRestrictions, setShowRestrictions] = useState(Boolean(restrictions))

  return (
    <SectionBlock title={title}>
      <div className="space-y-2">
        {[
          { value: 'yes' as const, label: 'Yes, make anatomical gifts' },
          { value: 'defer' as const, label: 'Defer to healthcare agent or donor registry' },
          { value: 'no' as const, label: 'No, do not make anatomical gifts' },
        ].map(option => (
          <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <input
              type="radio"
              name={`${title}-anatomical-gift`}
              checked={preference === option.value}
              onChange={() => onPreferenceChange(option.value)}
              className="mt-1"
            />
            <span className="text-sm font-medium text-foreground">{option.label}</span>
          </label>
        ))}
      </div>

      <div className="mt-4">
        <DesignSheetCheckboxOption
          label="Any restrictions on anatomical gifts?"
          description="Specify any organs, tissues, or parts the client does not wish to donate, or any other restrictions."
          checked={showRestrictions}
          onChange={checked => {
            setShowRestrictions(checked)
            if (!checked) {
              setLocalRestrictions('')
              onRestrictionsChange(null)
            } else if (!localRestrictions.trim()) {
              onRestrictionsChange('')
            }
          }}
        />
        {showRestrictions && (
          <>
            <Textarea
              value={localRestrictions}
              onChange={e => setLocalRestrictions(e.target.value)}
              onBlur={() => onRestrictionsChange(localRestrictions.trim() || null)}
              placeholder="e.g. Cornea only, for transplant"
              className="mt-3 min-h-[80px] resize-y border-border bg-card text-sm leading-relaxed"
            />
            <ClauseLibraryActions />
          </>
        )}
      </div>
    </SectionBlock>
  )
}

function AdvanceDirectiveBlock({
  title,
  value,
  onChange,
}: {
  title: string
  value: AdvanceDirectiveChoice | null
  onChange: (value: AdvanceDirectiveChoice) => void
}) {
  return (
    <SectionBlock title={title}>
      <div className="space-y-2">
        {[
          {
            value: 'prolong_life' as const,
            label: 'Prolong Life',
            description: 'Prolong life within the limits of generally accepted health care standards.',
          },
          {
            value: 'do_not_resuscitate' as const,
            label: 'Do Not Resuscitate',
            description: 'Provide life-prolonging care, but do not perform CPR or put the client on a ventilator.',
          },
          {
            value: 'do_not_prolong_life' as const,
            label: 'Do Not Prolong Life',
            description: 'Do not prolong life, only provide medical care for pain, anxiety, and comfort.',
          },
        ].map(option => (
          <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <input
              type="radio"
              name={`${title}-advance-directive`}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </SectionBlock>
  )
}

export function HealthCareDesignSection(props: HealthCareDesignSectionProps) {
  const { sheet, onChange, contacts, matter } = props
  const inclusions = getDocumentInclusions(sheet)
  const provisions = getDesignSheetHealthcareProvisions(sheet)
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseDocs = isMarriedSheet(sheet) && inclusions.spouse_docs
  const settlorLabel = clientFirst || 'Settlor'

  const updateProvisions = (patch: Parameters<typeof setDesignSheetHealthcareProvisions>[1]) => {
    onChange('decisions', setDesignSheetHealthcareProvisions(sheet, patch))
  }

  const toggleHipaaAgent = (
    party: 'client' | 'spouse',
    contactId: string,
  ) => {
    const key = party === 'client'
      ? 'client_hipaa_additional_agent_contact_ids'
      : 'spouse_hipaa_additional_agent_contact_ids'
    const current = new Set(provisions[key])
    if (current.has(contactId)) current.delete(contactId)
    else current.add(contactId)
    updateProvisions({ [key]: Array.from(current) })
  }

  if (!inclusions.healthcare) return null

  const renderAdditionalHipaaAgents = (
    title: string,
    description: string,
    selectedIds: string[],
    party: 'client' | 'spouse',
  ) => (
    <SectionBlock title={title}>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="space-y-2">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contacts available. Add contacts in the Contacts section.</p>
        ) : (
          contacts.map(contact => {
            const name = `${contact.first_name} ${contact.last_name}`.trim()
            const selected = selectedIds.includes(contact.id)
            return (
              <label key={contact.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleHipaaAgent(party, contact.id)}
                />
                <span className="text-sm text-foreground">{name}</span>
              </label>
            )
          })
        )}
      </div>
    </SectionBlock>
  )

  return (
    <div>
      <FiduciaryBlock
        {...props}
        role="hcp"
        slotScope="primary"
        sectionTitle={`${clientFirst || 'Client'}'s Health Care Proxy`}
        primaryLabel="First Agent"
        altLabel="First Agent"
      />
      <FiduciaryBlock
        {...props}
        role="hcp"
        slotScope="backup"
        sectionTitle="Backup Agent(s)"
        primaryLabel="Backup Agent"
        altLabel="Backup Agent"
      />

      <AnatomicalGiftBlock
        title={`${clientFirst || 'Client'}'s Anatomical gifts preference`}
        preference={provisions.client_anatomical_gift}
        restrictions={sheet.hcp_anatomical_specified}
        onPreferenceChange={value => {
          updateProvisions({ client_anatomical_gift: value })
          const legacy = anatomicalGiftToLegacy(value)
          if (legacy) onChange('hcp_anatomical_gift', legacy)
        }}
        onRestrictionsChange={value => onChange('hcp_anatomical_specified', value)}
      />

      {spouseDocs && (
        <>
          <FiduciaryBlock
            {...props}
            role="hcp"
            slotField="spouse_hcp_slots"
            slotScope="primary"
            sectionTitle={`${spouseFirst || 'Spouse'}'s Health Care Proxy`}
            primaryLabel="First Agent"
            altLabel="First Agent"
          />
          <FiduciaryBlock
            {...props}
            role="hcp"
            slotField="spouse_hcp_slots"
            slotScope="backup"
            sectionTitle="Backup Agent(s)"
            primaryLabel="Backup Agent"
            altLabel="Backup Agent"
          />

          <AnatomicalGiftBlock
            title={`${spouseFirst || 'Spouse'}'s Anatomical gifts preference`}
            preference={provisions.spouse_anatomical_gift}
            restrictions={provisions.spouse_anatomical_restrictions}
            onPreferenceChange={value => updateProvisions({ spouse_anatomical_gift: value })}
            onRestrictionsChange={value => updateProvisions({ spouse_anatomical_restrictions: value })}
          />
        </>
      )}

      <SectionBlock title="HIPAA Authorization">
        <p className="mb-4 text-sm text-muted-foreground">
          A HIPAA Authorization allows the client to designate who can access their medical information. The authorization includes all agents designated in the Advance Health Care Directive. You may choose to include trustees and POA agents.
        </p>

        <div className="space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">HIPAA Authorization Settings</p>
          <DesignSheetCheckboxOption
            label="Include the general (financial) durable power of attorney in the HIPAA authorization"
            description="If selected, the attorney-in-fact under any general power of attorney will be able to access the principal's medical information. If the package includes a Power of Attorney document, this document will also include provisions for access to medical information."
            checked={provisions.hipaa_include_poa}
            onChange={checked => updateProvisions({ hipaa_include_poa: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include trustee and successor trustees in the HIPAA authorization"
            description="If selected, the trustee of any revocable living trust with the principal as a settlor will be able to access the principal's medical information. You may include this whether or not you are preparing a trust concurrently."
            checked={provisions.hipaa_include_trustees}
            onChange={checked => updateProvisions({ hipaa_include_trustees: checked })}
          />

          <div>
            <FieldLabel>List fiduciaries by name in the HIPAA authorization?</FieldLabel>
            <p className="mb-2 text-xs text-muted-foreground">
              Controls whether trustees, POA agents, and healthcare agents are listed by name, or whether only general language is used.
            </p>
            <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
              {[
                { value: 'by_name' as const, label: 'List fiduciaries by name' },
                { value: 'general_language' as const, label: 'Use general language only' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateProvisions({ hipaa_list_fiduciaries_by_name: option.value })}
                  className={`flex-1 rounded-md px-3 py-2 text-[12px] transition-all ${
                    provisions.hipaa_list_fiduciaries_by_name === option.value
                      ? 'bg-card font-semibold text-primary shadow-sm'
                      : 'text-foreground hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SectionBlock>

      {spouseDocs ? (
        <>
          {renderAdditionalHipaaAgents(
            `${clientFirst || 'Client'}'s Additional HIPAA Agents`,
            `Select individuals who may access ${(clientFirst || 'the client')}'s medical information. Any trustees (if applicable), healthcare agents, and attorneys-in-fact (if checked above) will already be included, so you do not have to select them here.`,
            provisions.client_hipaa_additional_agent_contact_ids,
            'client',
          )}
          {renderAdditionalHipaaAgents(
            `${spouseFirst || 'Spouse'}'s Additional HIPAA Agents`,
            `Select individuals who may access ${(spouseFirst || 'the spouse')}'s medical information. Any trustees (if applicable), healthcare agents, and attorneys-in-fact (if checked above) will already be included, so you do not have to select them here.`,
            provisions.spouse_hipaa_additional_agent_contact_ids,
            'spouse',
          )}
        </>
      ) : (
        renderAdditionalHipaaAgents(
          'Additional HIPAA Agents',
          `Select individuals who may access ${settlorLabel}'s medical information. Any trustees (if applicable), healthcare agents, and attorneys-in-fact (if checked above) will already be included, so you do not have to select them here.`,
          provisions.client_hipaa_additional_agent_contact_ids,
          'client',
        )
      )}

      <AdvanceDirectiveBlock
        title={`${clientFirst || 'Client'}'s Advance Health Directive`}
        value={provisions.client_advance_directive}
        onChange={value => updateProvisions({ client_advance_directive: value })}
      />

      {spouseDocs && (
        <AdvanceDirectiveBlock
          title={`${spouseFirst || 'Spouse'}'s Advance Health Directive`}
          value={provisions.spouse_advance_directive}
          onChange={value => updateProvisions({ spouse_advance_directive: value })}
        />
      )}
    </div>
  )
}
