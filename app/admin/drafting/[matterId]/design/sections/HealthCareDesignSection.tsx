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
import type { MatterContact, PipelineMatter } from '@/types/database'
import { isMarriedSheet } from './fiduciary-blocks'
import type { SectionProps } from './shared'
import {
  ClientDecisionCallout,
  DecisionRow,
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
      <DecisionRow
        question="Anatomical gift preference"
        blocking
        value={preference}
        options={[
          { value: 'yes' as const, label: 'Yes, make anatomical gifts' },
          { value: 'defer' as const, label: 'Defer to healthcare agent or donor registry' },
          { value: 'no' as const, label: 'No, do not make anatomical gifts' },
        ]}
        onChange={onPreferenceChange}
      />

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
      <DecisionRow
        question="Life-support preference"
        help="Choose the direction used in the advance health directive."
        blocking
        value={value}
        options={[
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
        ]}
        onChange={onChange}
      />
    </SectionBlock>
  )
}


/** The wishes and post-death choices the interview form asks of each settlor. */
function HealthCareWishesBlock({ title, party, provisions, update }: {
  title: string
  party: 'client' | 'spouse'
  provisions: ReturnType<typeof getDesignSheetHealthcareProvisions>
  update: (patch: Parameters<typeof setDesignSheetHealthcareProvisions>[1]) => void
}) {
  const p = <K extends string>(key: K) => `${party}_${key}` as keyof typeof provisions
  const bool = (key: string) => provisions[p(key)] as boolean
  const text = (key: string) => (provisions[p(key)] as string | null) ?? ''
  const set = (key: string, value: unknown) => update({ [`${party}_${key}`]: value } as never)

  return (
    <>
      <SectionBlock title={`${title} — Wishes`}>
        <div className="mt-6 space-y-3">
          <DesignSheetCheckboxOption
            label="Leave health care instructions blank"
            description="The proxy is signed without treatment instructions; the agent decides in the moment."
            checked={bool('leave_instructions_blank')}
            onChange={checked => set('leave_instructions_blank', checked)}
          />
          <DesignSheetCheckboxOption
            label="Receive hygiene and comfort care"
            description="Comfort and hygiene care continue regardless of any instruction to withhold treatment."
            checked={bool('receive_comfort_care')}
            onChange={checked => set('receive_comfort_care', checked)}
          />
          <DesignSheetCheckboxOption
            label="Wish to die at home"
            description="Records a preference to be cared for at home rather than in a facility where practicable."
            checked={bool('wish_to_die_at_home')}
            onChange={checked => set('wish_to_die_at_home', checked)}
          />
          <DesignSheetCheckboxOption
            label="Decline autopsy"
            description="Records an objection to autopsy except where the law requires one."
            checked={bool('decline_autopsy')}
            onChange={checked => set('decline_autopsy', checked)}
          />
        </div>
        <div className="mt-4">
          <FieldLabel>Other health care wishes</FieldLabel>
          <Textarea
            value={text('other_healthcare_wishes')}
            onChange={event => set('other_healthcare_wishes', event.target.value || null)}
            placeholder="Religious, cultural, or personal instructions"
            rows={3}
          />
        </div>
      </SectionBlock>

      <SectionBlock title={`${title} — Agent Authority`}>
        <div className="mt-6 space-y-3">
          <DesignSheetCheckboxOption
            label="Agent's authority is effective immediately"
            description="Otherwise the authority springs on a determination of incapacity."
            checked={bool('agent_effective_immediately')}
            onChange={checked => set('agent_effective_immediately', checked)}
          />
          <DesignSheetCheckboxOption
            label="Include post-death authority and instructions for final disposition"
            description="Lets the health care agent act after death for disposition purposes."
            checked={bool('include_post_death_authority')}
            onChange={checked => set('include_post_death_authority', checked)}
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabel>Limits while living</FieldLabel>
            <Textarea
              value={text('agent_limits_while_living')}
              onChange={event => set('agent_limits_while_living', event.target.value || null)}
              rows={2}
            />
          </div>
          <div>
            <FieldLabel>Limits after death</FieldLabel>
            <Textarea
              value={text('agent_limits_after_death')}
              onChange={event => set('agent_limits_after_death', event.target.value || null)}
              rows={2}
            />
          </div>
        </div>
        <div className="mt-6">
          <DecisionRow
            question="How should co-agents resolve disagreements?"
            value={(provisions[p('coagent_disagreement_resolution')] as string | null) ?? ''}
            options={[
              { value: 'omit', label: 'Do not include' },
              { value: 'majority', label: 'Majority rules' },
              { value: 'unanimous', label: 'Unanimous agreement required' },
              { value: 'first_named', label: 'First-named agent has final authority' },
            ]}
            onChange={value => set('coagent_disagreement_resolution', value || null)}
          />
        </div>
      </SectionBlock>

      <SectionBlock title={`${title} — Post-Death Choices`}>
        <div className="mt-6">
          <DecisionRow
            question="How should the remains be handled?"
            value={(provisions[p('disposition_of_remains')] as string | null) ?? ''}
            options={[
              { value: 'cremation', label: 'Cremation' },
              { value: 'chemical_cremation', label: 'Chemical cremation (alkaline hydrolysis)' },
              { value: 'burial', label: 'Burial' },
              { value: 'no_specific_wishes', label: 'No specific wishes' },
              { value: 'leave_blank', label: 'Leave blank in document' },
              { value: 'other', label: 'Other' },
            ]}
            onChange={value => set('disposition_of_remains', value || null)}
          />
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <FieldLabel>Funeral instructions</FieldLabel>
            <Textarea
              value={text('funeral_instructions')}
              onChange={event => set('funeral_instructions', event.target.value || null)}
              rows={2}
            />
          </div>
          <div>
            <FieldLabel>Pre-need or post-death arrangements</FieldLabel>
            <Textarea
              value={text('preneed_arrangements')}
              onChange={event => set('preneed_arrangements', event.target.value || null)}
              rows={2}
            />
          </div>
          <div>
            <FieldLabel>Other disposition instructions</FieldLabel>
            <Textarea
              value={text('other_disposition_instructions')}
              onChange={event => set('other_disposition_instructions', event.target.value || null)}
              rows={2}
            />
          </div>
        </div>
        <div className="mt-6 space-y-3">
          <DesignSheetCheckboxOption
            label="Preference for donations"
            description="Asks that mourners give to a named cause rather than send flowers."
            checked={bool('preference_for_donations')}
            onChange={checked => set('preference_for_donations', checked)}
          />
          <DesignSheetCheckboxOption
            label="Prohibit AI replicas or digital recreations"
            description="Withholds consent to synthetic recreations of voice or likeness after death."
            checked={bool('prohibit_ai_replicas')}
            onChange={checked => set('prohibit_ai_replicas', checked)}
          />
          <DesignSheetCheckboxOption
            label="Make disposition agents the same as health care agents"
            description="Otherwise the disposition agents are named separately."
            checked={bool('disposition_agents_same_as_healthcare')}
            onChange={checked => set('disposition_agents_same_as_healthcare', checked)}
          />
          <DesignSheetCheckboxOption
            label="Include disposition agent acceptance"
            description="Adds a signature block for each disposition agent to accept the appointment."
            checked={bool('include_disposition_agent_acceptance')}
            onChange={checked => set('include_disposition_agent_acceptance', checked)}
          />
        </div>
      </SectionBlock>
    </>
  )
}

export function HealthCareDesignSection(props: HealthCareDesignSectionProps) {
  const { sheet, onChange, contacts, matter } = props
  const inclusions = getDocumentInclusions(sheet)
  const provisions = getDesignSheetHealthcareProvisions(sheet)
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const married = isMarriedSheet(sheet)
  const spouseDocs = married && inclusions.spouse_docs
  const settlorLabel = clientFirst || 'Settlor'

  const updateProvisions = (patch: Parameters<typeof setDesignSheetHealthcareProvisions>[1]) => {
    onChange('decisions', prevSheet => setDesignSheetHealthcareProvisions(prevSheet, patch))
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

          <DecisionRow
            question="HIPAA fiduciary scope"
            help="Controls whether trustees, POA agents, and healthcare agents are listed by name, or whether only general language is used."
            value={provisions.hipaa_list_fiduciaries_by_name}
            options={[
              { value: 'by_name', label: 'List fiduciaries by name' },
              { value: 'general_language', label: 'Use general language only' },
            ]}
            onChange={value => updateProvisions({ hipaa_list_fiduciaries_by_name: value })}
          />
        </div>
      </SectionBlock>

      {married ? (
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

      {/* Lived in WillProvisionsSection behind a `healthcare` scope that section
          is never rendered with, so the question could not be answered at all. */}
      <SectionBlock title="HIPAA Authorization — Psychotherapy Notes" subtitle="Client must initial — no default">
        <ClientDecisionCallout>Psychotherapy notes disclosure. Client must initial — never default.</ClientDecisionCallout>
        <DecisionRow
          fieldName="hipaa_psychotherapy_notes"
          question="Psychotherapy notes"
          value={sheet.hipaa_psychotherapy_notes}
          options={[
            { value: 'authorize', label: 'Authorize disclosure' },
            { value: 'do_not_authorize', label: 'Do NOT authorize disclosure' },
          ]}
          onChange={value => onChange('hipaa_psychotherapy_notes', value)}
        />
      </SectionBlock>

      <SectionBlock title="Health Care Proxy Options">
        <div className="mt-6">
          <DesignSheetCheckboxOption
            label="Include Notice Page"
            description="Prepends the statutory notice page to each health care proxy."
            checked={provisions.include_hcp_notice_page}
            onChange={checked => updateProvisions({ include_hcp_notice_page: checked })}
          />
        </div>
      </SectionBlock>

      <HealthCareWishesBlock
        title={clientFirst || 'Client'}
        party="client"
        provisions={provisions}
        update={updateProvisions}
      />

      {spouseDocs && (
        <HealthCareWishesBlock
          title={spouseFirst || 'Spouse'}
          party="spouse"
          provisions={provisions}
          update={updateProvisions}
        />
      )}
    </div>
  )
}
