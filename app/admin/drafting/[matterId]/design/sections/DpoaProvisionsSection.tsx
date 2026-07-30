'use client'

import { useState } from 'react'
import { BookOpen, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  coagentMannerFromServing,
  DPOA_BASIC_POWER_KEYS,
  DPOA_BASIC_POWER_LABELS,
  getDesignSheetDpoaProvisions,
  setDesignSheetDpoaProvisions,
  type DpoaAgentCompensation,
  type DpoaBasicPowerKey,
  type DpoaCoagentServing,
} from '@/lib/designSheetDpoaProvisions'
import {
  AttorneyNoteBanner,
  DecisionRow,
  DesignSheetCheckboxOption,
  FieldLabel,
  SectionBlock,
  type SectionProps,
} from './shared'

export function DpoaProvisionsSection({ sheet, onChange }: SectionProps) {
  const provisions = getDesignSheetDpoaProvisions(sheet)
  const clientFirst = (sheet.client_name ?? '').trim().split(/\s+/)[0] || '[Settlor]'

  const [additionalPowers, setAdditionalPowers] = useState(provisions.additional_powers ?? '')
  const [specificBusinesses, setSpecificBusinesses] = useState(provisions.specific_businesses ?? '')
  const [additionalLimitations, setAdditionalLimitations] = useState(provisions.additional_limitations ?? '')

  const updateProvisions = (patch: Parameters<typeof setDesignSheetDpoaProvisions>[1]) => {
    onChange('decisions', prevSheet => setDesignSheetDpoaProvisions(prevSheet, patch))
  }

  const updateCoagentServing = (serving: DpoaCoagentServing) => {
    onChange('dpoa_coagent_manner', coagentMannerFromServing(serving))
    updateProvisions({ coagent_serving: serving })
  }

  const updateCompensation = (value: DpoaAgentCompensation) => {
    updateProvisions({ agent_compensation: value })
  }

  const updateBasicPower = (key: DpoaBasicPowerKey, checked: boolean) => {
    updateProvisions({
      basic_powers: {
        ...provisions.basic_powers,
        [key]: checked,
      },
      all_basic_powers: false,
    })
  }

  const toggleAllBasicPowers = (checked: boolean) => {
    updateProvisions({ all_basic_powers: checked })
  }

  return (
    <div>
      <AttorneyNoteBanner>
        Select optional document modules, compensation, co-agent decision-making, gifting and trust powers, and attorney-in-fact authority below.
      </AttorneyNoteBanner>

      <SectionBlock
        title="Optional Document Modules"
        subtitle="The Cornerstone POA template includes three opt-in sections. Leave unchecked for the leanest document."
      >
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="Entity & Business"
            description="Includes oil/gas/mineral powers through partnership and LLC powers (Section 3.J through Section 3.L)."
            checked={provisions.include_entity_powers}
            onChange={checked => updateProvisions({ include_entity_powers: checked })}
          />
          <DesignSheetCheckboxOption
            label="Advanced Trust & Gifting"
            description="Includes amend-trust powers and gifting subsections (c) through (g)."
            checked={provisions.include_advanced_trust_gifting}
            onChange={checked => updateProvisions({ include_advanced_trust_gifting: checked })}
          />
          <DesignSheetCheckboxOption
            label="Extended Personal Care"
            description="Includes recreation, religious, and companionship powers (Section 4.D through 4.F) and pet care (Section 5.I)."
            checked={provisions.include_extended_personal_care}
            onChange={checked => updateProvisions({ include_extended_personal_care: checked })}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Compensation for Agents">
        <DecisionRow
          question="Agent compensation"
          fieldName="dpoa_provisions.agent_compensation"
          blocking
          value={provisions.agent_compensation}
          options={[
            { value: 'prevailing_professional', label: 'Prevailing Rate for Professional Fiduciaries', description: 'Compensation shall be in the range of then-prevailing rates charged by professional fiduciaries.' },
            { value: 'reasonable', label: 'Reasonable Compensation', description: 'Compensation shall be a reasonable fee based on time and effort.' },
            { value: 'none', label: 'No Compensation', description: 'Agents may not receive compensation.' },
          ]}
          onChange={updateCompensation}
        />
      </SectionBlock>

      <SectionBlock
        title="Should co-agents serve jointly, separately, or should the document be silent?"
        subtitle="If multiple people are serving, select how they should make decisions."
      >
        <DecisionRow
          question="Co-agent decision-making"
          fieldName="dpoa_provisions.coagent_serving"
          blocking
          value={provisions.coagent_serving}
          options={[
            { value: 'jointly', label: 'Co-agents must act jointly', description: 'All decisions require the unanimous agreement of all then-acting co-agents.' },
            { value: 'separately', label: 'Co-agents may act separately', description: 'Each co-agent may act independently without the consent of any other co-agent.' },
            { value: 'silent', label: 'Do not include', description: 'The document will be silent on co-agent decision-making.' },
          ]}
          onChange={updateCoagentServing}
        />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Note: This form allows you to designate co-agents. However, banks may not accept co-agents as a matter of policy.
        </p>
      </SectionBlock>

      <SectionBlock title="Gifting Powers">
        <DecisionRow
          question="Allow gifts?"
          help="Choose whether the agent receives gifting powers."
          value={provisions.allow_gifts ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: 'Allow gifts' },
            { value: 'no', label: 'Do not allow gifts' },
          ]}
          onChange={value => updateProvisions({ allow_gifts: value === 'yes' })}
        />
      </SectionBlock>

      <SectionBlock
        title="Trust Powers"
        subtitle="It is unusual to give the agent the power to do estate planning on behalf of the principal. These powers are typically granted with a specific purpose in mind (e.g. Medicaid planning)."
      >
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="Agent may create trusts"
            description={"Select to allow the agent to create revocable and/or irrevocable trusts for the benefit of the principal on their behalf. All trusts so created must be in accordance with the principal's intentions as expressed in existing estate planning documents."}
            checked={provisions.agent_may_create_trusts}
            onChange={checked => updateProvisions({ agent_may_create_trusts: checked })}
          />
          <DesignSheetCheckboxOption
            label="Agent may create trusts for dependents"
            description={"Select to allow the agent to create trusts for the benefit of the principal's dependents on the principal's behalf. All trusts must be in accordance with the principal's intentions as expressed in existing estate planning documents."}
            checked={provisions.agent_may_create_trusts_for_dependents}
            onChange={checked => updateProvisions({ agent_may_create_trusts_for_dependents: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow agent to be trustee"
            description="Select to allow the agent to designate themselves as a trustee of a trust they create on the principal's behalf."
            checked={provisions.allow_agent_as_trustee}
            onChange={checked => updateProvisions({ allow_agent_as_trustee: checked })}
          />
          <DesignSheetCheckboxOption
            label="Agent may create Medicaid planning trusts"
            description="Select to allow the agent to create irrevocable trusts specifically to qualify the principal for Medicaid or other public benefits. This may be redundant if the agent will be given the general power to create trusts."
            checked={provisions.agent_may_create_medicaid_trusts}
            onChange={checked => updateProvisions({ agent_may_create_medicaid_trusts: checked })}
          />
          <DesignSheetCheckboxOption
            label="Agent may modify sole-settlor trusts"
            description={"Select to allow the agent to amend or revoke a trust of which the principal is the sole settlor. All modifications must be in accordance with the principal's intentions as expressed in existing estate planning documents."}
            checked={provisions.agent_may_modify_sole_settlor_trusts}
            onChange={checked => updateProvisions({ agent_may_modify_sole_settlor_trusts: checked })}
          />
          <DesignSheetCheckboxOption
            label="Agent may modify joint trusts"
            description={"Select to allow the agent to revoke or modify a joint trust of which they and the principal are co-settlors. Gives the principal's spouse or partner the ability to modify their joint trust if the principal is incapacitated. All modifications must be in accordance with the principal's intentions as expressed in existing estate planning documents."}
            checked={provisions.agent_may_modify_joint_trusts}
            onChange={checked => updateProvisions({ agent_may_modify_joint_trusts: checked })}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Miscellaneous Special Powers">
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="Allow delegation of authority"
            description="Select to allow the agent(s) to delegate their authority to make discretionary decisions to professionals (e.g. financial advisors). Banks and institutions may not allow delegation of authority."
            checked={provisions.allow_delegation}
            onChange={checked => updateProvisions({ allow_delegation: checked })}
          />
          <DesignSheetCheckboxOption
            label="Prohibit arbitration"
            description="Select to prohibit the agent(s) from submitting to arbitration on behalf of the principal."
            checked={provisions.prohibit_arbitration}
            onChange={checked => updateProvisions({ prohibit_arbitration: checked })}
          />
          <DesignSheetCheckboxOption
            label="Power to manage §529 educational savings plans"
            description="Select to allow the agent to manage §529 educational savings plans."
            checked={provisions.power_529_plans}
            onChange={checked => updateProvisions({ power_529_plans: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow agent to access medical information"
            description="If selected, the power of attorney will include a provision granting access to the principal's medical information. This will also explicitly include the power of attorney in the HIPAA Authorization, if this document package includes a HIPAA Authorization."
            checked={provisions.allow_medical_information_access}
            onChange={checked => updateProvisions({ allow_medical_information_access: checked })}
          />
          <DesignSheetCheckboxOption
            label="Power to control digital assets and devices"
            description="Select to allow the agent to control digital assets, accounts, and devices."
            checked={provisions.power_digital_assets}
            onChange={checked => updateProvisions({ power_digital_assets: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow self-designation for beneficiary designations"
            description="Select to allow the agent(s) to use their authority over beneficiary designations to designate themselves as the beneficiary of an insurance policy, annuity, or other asset. Use with caution, as this power may be abused."
            checked={provisions.allow_self_designation_beneficiary}
            onChange={checked => updateProvisions({ allow_self_designation_beneficiary: checked })}
          />
        </div>
      </SectionBlock>

      <SectionBlock
        title="Attorney-in-Fact(s) Powers"
        subtitle={`Select all powers that the Attorney-in-fact(s) may exercise on ${clientFirst}'s behalf, or select "All powers in this list" to grant all of them.`}
      >
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="All powers in this list"
            checked={provisions.all_basic_powers}
            onChange={toggleAllBasicPowers}
          />
          {DPOA_BASIC_POWER_KEYS.map(key => (
            <DesignSheetCheckboxOption
              key={key}
              label={DPOA_BASIC_POWER_LABELS[key]}
              checked={provisions.basic_powers[key]}
              onChange={checked => updateBasicPower(key, checked)}
            />
          ))}
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <FieldLabel>Additional Powers</FieldLabel>
            <p className="mb-2 text-[12px] text-muted-foreground">Describe any additional powers to include.</p>
            <Textarea
              value={additionalPowers}
              onChange={e => setAdditionalPowers(e.target.value)}
              onBlur={() => updateProvisions({ additional_powers: additionalPowers.trim() || null })}
              placeholder="Optional additional powers…"
              className="min-h-[100px] resize-y border-border bg-card text-sm leading-relaxed"
              maxLength={4000}
            />
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
          </div>

          <div>
            <FieldLabel>Name Specific Businesses</FieldLabel>
            <p className="mb-2 text-[12px] text-muted-foreground">
              List specific businesses that the Attorney-in-fact(s) may manage on the principal&apos;s behalf. These will be named in the &quot;Operate Business&quot; section of the Attorney-in-fact(s) powers.
            </p>
            <Input
              value={specificBusinesses}
              onChange={e => setSpecificBusinesses(e.target.value)}
              onBlur={() => updateProvisions({ specific_businesses: specificBusinesses.trim() || null })}
              placeholder="e.g. Maple Street LLC"
            />
          </div>

          <div>
            <FieldLabel>Additional Limitations</FieldLabel>
            <p className="mb-2 text-[12px] text-muted-foreground">Describe any additional limitations to include in the POA.</p>
            <Textarea
              value={additionalLimitations}
              onChange={e => setAdditionalLimitations(e.target.value)}
              onBlur={() => updateProvisions({ additional_limitations: additionalLimitations.trim() || null })}
              placeholder="Optional limitations…"
              className="min-h-[100px] resize-y border-border bg-card text-sm leading-relaxed"
              maxLength={4000}
            />
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
          </div>
        </div>
      </SectionBlock>
    </div>
  )
}
