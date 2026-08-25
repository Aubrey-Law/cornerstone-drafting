'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { deriveTrustName, deriveSpouseTrustName } from '@/lib/designSheetDefaults'
import {
  getTrustPlanningType,
  setTrustPlanningType,
  type TrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import {
  buildSpouseTrustNameSuggestions,
  buildStaggeredTiersFromPreset,
  buildTrustNameSuggestions,
  getTrustDetails,
  getTrustNameFormat,
  resolveResidualBeneficiaryMethod,
  setTrustDetails,
  setTrustNameFormat,
  STAGGERED_DISTRIBUTION_PRESETS,
  type InitialTrusteeNomination,
  type ParentChildRelationshipDefinition,
  type RepresentationType,
  type ResidualBeneficiaryMethod,
  type ResiduaryAfterDeath,
  type SettlorIncapacityDeterminer,
  type SuccessorTrusteeVacancy,
  type TrusteeIncapacityDeterminer,
  type TrustCoTrusteeDecision,
  type TrusteeCompensation,
} from '@/lib/designSheetTrustDetails'
import type { DesignSheet, MatterContact, PetCareDetails, PipelineMatter, StaggeredTier } from '@/types/database'
import DesignContactPicker, { type Contact as PickerContact } from './ContactPicker'
import type { SectionProps } from './shared'
import {
  AttorneyInput,
  AttorneySelect,
  ClientDecisionCallout,
  DecisionRow,
  DesignSheetCheckboxOption,
  FieldLabel,
  DesignSectionContent,
  PrefilledInput,
  SectionBlock,
  toYesNo,
  yesNoField,
} from './shared'
import { isMarriedSheet as isMarried } from './fiduciary-blocks'
import { TrustBeneficiariesSection } from './TrustBeneficiariesSection'

/**
 * Typed against ResidualBeneficiaryMethod so an option value that drifts from the
 * union is a compile error. It drifted once — `trust-for-life` here against
 * `trust_for_life` in the union — and an `as` cast at the change handler hid it,
 * which meant a lifetime trust could resolve as a staged distribution.
 */
const RESIDUAL_BENEFICIARY_METHOD_OPTIONS: readonly {
  value: ResidualBeneficiaryMethod
  label: string
  description?: string
}[] = [
  { value: 'outright', label: 'Outright' },
  { value: 'staggered', label: 'Staggered', description: 'For example, distributions at ages 25, 30, and 35.' },
  { value: 'trust_for_life', label: 'Held in trust for lifetime' },
  { value: 'custom', label: 'Custom distribution schedule' },
]

interface DocumentSectionProps extends SectionProps {
  contacts: MatterContact[]
  matter: PipelineMatter
  onAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

const SPOUSAL_TRUST_FUNDING_OPTIONS: { value: TrustPlanningType; label: string; description: string }[] = [
  {
    value: 'outright_to_spouse',
    label: 'Outright to Spouse',
    description: 'Distributes the residuary estate outright to the surviving spouse.',
  },
  {
    value: 'disclaimer',
    label: 'Disclaimer',
    description: 'Outright to spouse with a Marital (QTIP) / Family (bypass) split if the spouse disclaims.',
  },
  {
    value: 'clayton_election',
    label: 'Clayton Election',
    description: 'Uses a Clayton QTIP election for the marital share with a family/bypass trust for the balance.',
  },
  {
    value: 'not_to_spouse',
    label: 'Do Not Distribute to Spouse/Partner',
    description: 'The residuary skips the surviving spouse and passes under the descendants distribution.',
  },
]

function SectionHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md border border-blue-strong-border bg-blue-bg px-3 py-2">
      <p className="text-[11px] text-blue">{children}</p>
    </div>
  )
}

function TrustNameFormatFields({
  sheet,
  onChange,
  scope,
}: {
  sheet: DesignSheet
  onChange: SectionProps['onChange']
  scope: 'client' | 'spouse'
}) {
  const format = getTrustNameFormat(sheet, scope)
  const update = (patch: Parameters<typeof setTrustNameFormat>[2]) =>
    onChange('decisions', prevSheet => setTrustNameFormat(prevSheet, scope, patch))

  return (
    <div className="space-y-3">
      <DecisionRow
        question="Trust Name Format"
        help="Controls how the trust name will appear on deeds and other transfer documents."
        value={format.date_style}
        options={[
          { value: 'ua_dated', label: 'Use “U/A dated”', description: 'e.g., THE SMITH TRUST, U/A dated January 15, 2025' },
          { value: 'dated_only', label: 'Use “dated” only', description: 'e.g., THE SMITH TRUST dated January 15, 2025' },
        ]}
        onChange={dateStyle => update({ date_style: dateStyle })}
      />
      <DesignSheetCheckboxOption
        label='Append "and any amendments thereto"'
        description='e.g., THE SMITH TRUST, U/A dated January 15, 2025, and any amendments thereto'
        checked={format.append_amendments}
        onChange={checked => update({ append_amendments: checked })}
      />
    </div>
  )
}

function TrustNameQuickFill({
  suggestions,
  onSelect,
}: {
  suggestions: string[]
  onSelect: (value: string) => void
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {suggestions.map(suggestion => (
        <Button
          key={suggestion}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  )
}

const SETTLOR_INCAPACITY_DETERMINER_OPTIONS = [
  { value: 'attending_and_second_physician', label: 'Attending and second physician' },
  { value: 'single_physician', label: 'Single licensed physician' },
  { value: 'attending_or_any_two_physicians', label: 'Attending or any two physicians' },
  { value: 'physician_or_psychologist', label: 'Single physician or clinical psychologist' },
  { value: 'two_physicians', label: 'Two licensed physicians' },
  { value: 'two_physicians_or_psychologists', label: 'Two physicians or psychologists' },
  { value: 'physician_and_psychologist', label: 'One physician and one psychologist' },
  { value: 'attorney_at_law', label: 'Attorney-at-law' },
  { value: 'governmental_official', label: 'Governmental official' },
  { value: 'trust_protector', label: 'Trust protector' },
  { value: 'successor_trustee', label: 'Successor trustee' },
  { value: 'majority_of_adult_children', label: 'Majority of adult children' },
  { value: 'incapacity_panel', label: 'Incapacity panel' },
  { value: 'court', label: 'Court of competent jurisdiction' },
  { value: 'other_settlor_and_successor_trustee', label: 'Other settlor and successor trustee' },
  { value: 'custom', label: 'Custom' },
]

const TRUSTEE_INCAPACITY_DETERMINER_OPTIONS = [
  { value: 'attending_and_second_physician', label: 'Attending and second physician' },
  { value: 'single_physician', label: 'Single licensed physician' },
  { value: 'attending_or_any_two_physicians', label: 'Attending or any two physicians' },
  { value: 'physician_or_psychologist', label: 'Single physician or clinical psychologist' },
  { value: 'two_physicians', label: 'Two licensed physicians' },
  { value: 'two_physicians_or_psychologists', label: 'Two physicians or psychologists' },
  { value: 'physician_and_psychologist', label: 'One physician and one psychologist' },
  { value: 'attorney_at_law', label: 'Attorney-at-law' },
  { value: 'governmental_official', label: 'Governmental official' },
  { value: 'trust_protector', label: 'Trust protector' },
  { value: 'court', label: 'Court of competent jurisdiction' },
  { value: 'custom', label: 'Custom' },
]

export function TrustDetailsSection(props: DocumentSectionProps & { scope?: 'client' | 'spouse' }) {
  const { sheet, onChange, contacts, matter, scope = 'client' } = props
  const { onAddContact, onUpdateContact } = props
  const original = (field: string) => sheet.overrides?.[field]?.original
  const derivedTrustName = deriveTrustName(sheet, matter)
  const derivedSpouseTrustName = deriveSpouseTrustName(sheet, matter)
  const clientFirst = (sheet.client_name ?? matter.client_name ?? '').trim().split(/\s+/)[0] || ''
  const spouseFirst = (sheet.spouse_name ?? matter.spouse_name ?? '').trim().split(/\s+/)[0] || ''
  const married = isMarried(sheet)
  const separate = married && sheet.is_joint === false
  const trustDetails = getTrustDetails(sheet)
  const spousalFunding = getTrustPlanningType(sheet)
  const trustNameSuggestions = buildTrustNameSuggestions(sheet, matter)
  const spouseTrustNameSuggestions = buildSpouseTrustNameSuggestions(sheet, matter)
  const [specialTrusteeInstructions, setSpecialTrusteeInstructions] = useState(
    trustDetails.special_trustee_instructions ?? '',
  )
  const autoMaritalDeductionSavings = spousalFunding === 'disclaimer' || spousalFunding === 'clayton_election'

  const updateTrustDetails = (patch: Parameters<typeof setTrustDetails>[1]) =>
    onChange('decisions', prevSheet => setTrustDetails(prevSheet, patch))

  useEffect(() => {
    if (trustDetails.protect_us_trust_status && !trustDetails.allow_special_trustee) {
      updateTrustDetails({ allow_special_trustee: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trustDetails.protect_us_trust_status])

  if (scope === 'spouse') {
    return (
      <DesignSectionContent>
        <SectionHelp>Configure the spouse&apos;s separate trust name.</SectionHelp>
        <SectionBlock title="Trust Name">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <PrefilledInput
                fieldName="spouse_trust_name"
                label={`${spouseFirst || 'Spouse'}'s Trust Name`}
                value={sheet.spouse_trust_name || derivedSpouseTrustName}
                originalValue={original('spouse_trust_name')}
                onChange={v => onChange('spouse_trust_name', v || null)}
              />
              <TrustNameQuickFill
                suggestions={buildSpouseTrustNameSuggestions(sheet, matter)}
                onSelect={v => onChange('spouse_trust_name', v)}
              />
            </div>
            <TrustNameFormatFields sheet={sheet} onChange={onChange} scope="spouse" />
          </div>
        </SectionBlock>

      </DesignSectionContent>
    )
  }

  const pickerContacts = contacts as unknown as PickerContact[]
  const adaptAdd = (data: Omit<PickerContact, 'id'>) =>
    onAddContact(data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<PickerContact>
  const adaptUpdate = onUpdateContact
    ? (id: string, data: Omit<PickerContact, 'id'>) =>
        onUpdateContact(id, data as unknown as Omit<MatterContact, 'id'>) as unknown as Promise<PickerContact>
    : undefined
  const residualContactById = (id: string): PickerContact | null =>
    (contacts.find(c => c.id === id) ?? null) as unknown as PickerContact | null
  const residualIndividuals = sheet.residual_beneficiary_individuals ?? []
  const setResidualIndividuals = (next: string[]) => onChange('residual_beneficiary_individuals', next)

  const staggers = sheet.staggered_distributions ?? []
  const parseAmt = (a: string | null | undefined): number | null => {
    const m = (a ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*%?$/)
    return m ? parseFloat(m[1]) : null
  }
  const setStaggers = (next: StaggeredTier[]) => {
    onChange('staggered_distributions', next)
    onChange('stagger_age_1', next[0]?.age ?? null)
    onChange('stagger_age_2', next[1]?.age ?? null)
    onChange('stagger_age_3', next[2]?.age ?? null)
    onChange('stagger_pct_1', parseAmt(next[0]?.amount))
    onChange('stagger_pct_2', parseAmt(next[1]?.amount))
  }
  const addStagger = () => setStaggers([...staggers, { id: crypto.randomUUID(), age: null, amount: null }])
  const editStagger = (i: number, patch: Partial<StaggeredTier>) =>
    setStaggers(staggers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  const removeStagger = (i: number) => setStaggers(staggers.filter((_, idx) => idx !== i))

  const documentOptions = [
    { value: 'will', label: 'Will' },
    { value: 'trust', label: 'Trust' },
  ]
  const pet: PetCareDetails = sheet.pet_care_details ?? {}
  const updatePet = (patch: Partial<PetCareDetails>) =>
    onChange('pet_care_details', { ...pet, ...patch })

  // Shared resolver rather than a local fallback: the UI, readiness and the
  // generator must agree on which stored value wins, and it normalises legacy
  // spellings so an older sheet still shows its choice as selected.
  const residualMethod = resolveResidualBeneficiaryMethod(sheet)
  const deathLabel = married
    ? `Following the death of ${clientFirst || 'Client'} and ${spouseFirst || 'Spouse'}, the remaining trust property shall be:`
    : `Following the death of ${clientFirst || 'Client'}, the remaining trust property shall be:`

  return (
    <DesignSectionContent>
      <SectionHelp>Configure the trust structure, name, protector, trustees, and how the residuary is distributed.</SectionHelp>

      <SectionBlock title="Trust Structure">
        <DecisionRow
          question="Joint or separate trusts?"
          help="Choose whether the spouses share one trust or use separate trusts."
          fieldName="is_joint"
          blocking
          value={sheet.is_joint == null ? null : sheet.is_joint ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: 'Joint trust' },
            { value: 'no', label: 'Separate trusts' },
          ]}
          onChange={v => onChange('is_joint', v === 'yes')}
        />
        {married && !sheet.is_joint && (
          <DecisionRow
            question="Spousal Trust Funding"
            help="Choose how the surviving spouse receives or holds the residuary estate."
            value={spousalFunding}
            options={SPOUSAL_TRUST_FUNDING_OPTIONS}
            onChange={value => onChange('decisions', prevSheet => setTrustPlanningType(prevSheet, value))}
          />
        )}
      </SectionBlock>

      <SectionBlock title="Trust Name">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <PrefilledInput
              fieldName="trust_name"
              label={separate ? `${clientFirst || 'Client'}'s Trust Name` : 'Trust Name'}
              value={sheet.trust_name || derivedTrustName}
              originalValue={original('trust_name')}
              onChange={v => onChange('trust_name', v)}
            />
            <TrustNameQuickFill suggestions={trustNameSuggestions} onSelect={v => onChange('trust_name', v)} />
          </div>
          <TrustNameFormatFields sheet={sheet} onChange={onChange} scope="client" />
        </div>
        {separate && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <PrefilledInput
                fieldName="spouse_trust_name"
                label={`${spouseFirst || 'Spouse'}'s Trust Name`}
                value={sheet.spouse_trust_name || derivedSpouseTrustName}
                originalValue={original('spouse_trust_name')}
                onChange={v => onChange('spouse_trust_name', v || null)}
              />
              <TrustNameQuickFill
                suggestions={spouseTrustNameSuggestions}
                onSelect={v => onChange('spouse_trust_name', v)}
              />
            </div>
            <TrustNameFormatFields sheet={sheet} onChange={onChange} scope="spouse" />
          </div>
        )}
      </SectionBlock>

      <SectionBlock title="Restatement">
        <DecisionRow
          question="Restatement"
          value={sheet.restatement ? 'yes' : 'no'}
          options={[
            { value: 'yes', label: 'Yes — restating existing trust' },
            { value: 'no', label: 'No — new trust' },
          ]}
          onChange={v => onChange('restatement', v === 'yes')}
        />
      </SectionBlock>

      <SectionBlock title="Trust Protector">
        <DecisionRow
          question="Include a trust protector?"
          help="A trust protector may provide additional governance flexibility."
          value={sheet.trust_protector ? 'yes' : 'no'}
          options={YES_NO}
          onChange={v => onChange('trust_protector', v === 'yes')}
        />
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          {sheet.trust_protector && (
            <AttorneyInput
              label="Trust Protector Full Name"
              value={sheet.trust_protector_name ?? ''}
              onChange={v => onChange('trust_protector_name', v || null)}
            />
          )}
        </div>
      </SectionBlock>

      <SectionBlock title="Trustee Provisions">
        <div className="mt-6">
          <DecisionRow
            question="Who serves as initial trustee?"
            fieldName="initial_trustee_nomination"
            value={trustDetails.initial_trustee_nomination ?? 'grantor'}
            options={[
              { value: 'grantor', label: 'The grantor', description: 'The settlor serves as their own initial trustee.' },
              { value: 'grantor_and_spouse', label: 'The grantor and spouse', description: 'Both spouses serve as initial co-trustees.' },
              { value: 'single_initial_trustee', label: 'A single named trustee', description: 'One person named on Fiduciary Role Assignment serves alone.' },
            ]}
            onChange={value => updateTrustDetails({ initial_trustee_nomination: value as InitialTrusteeNomination })}
          />
        </div>

        {separate ? (
          <div className="mt-6">
            <DecisionRow
              question="Who serves as initial trustee of the spouse's trust?"
              fieldName="spouse_initial_trustee_nomination"
              value={trustDetails.spouse_initial_trustee_nomination ?? 'spouse'}
              options={[
                { value: 'spouse', label: 'The spouse', description: 'The spouse serves as their own initial trustee.' },
                { value: 'client_and_spouse', label: 'Both spouses', description: 'Both spouses serve as initial co-trustees of this trust.' },
                { value: 'single_initial_trustee', label: 'A single named trustee', description: 'One person named on Fiduciary Role Assignment serves alone.' },
              ]}
              onChange={value => updateTrustDetails({ spouse_initial_trustee_nomination: value as InitialTrusteeNomination })}
            />
          </div>
        ) : null}

        <div className="mt-6">
          <DecisionRow
            question="If the trust ever has co-trustees, how should they make decisions?"
            value={trustDetails.co_trustee_decision ?? 'joint_majority'}
            options={[
            {
              value: 'joint_majority',
              label: 'Co-trustees must act jointly',
              description: 'The decision of a majority of co-trustees shall control.',
            },
            {
              value: 'independent',
              label: 'Co-trustees may act separately',
              description: "A single co-trustee's signature is sufficient to conduct business.",
            },
            {
              value: 'omit',
              label: 'Do not include',
              description: 'The document will be silent on co-trustee decision-making.',
            },
            {
              value: 'settlor_separate_others_joint',
              label: 'Settlors act separately, others jointly',
              description: 'While both settlors are serving as co-trustees, either settlor may act alone. Once either settlor stops serving, a majority of the remaining co-trustees must agree.',
            },
            ]}
            onChange={value => updateTrustDetails({ co_trustee_decision: value as TrustCoTrusteeDecision })}
          />
        </div>

        <div className="mt-6">
          <DecisionRow
            question="Trustee compensation"
            value={trustDetails.trustee_compensation ?? 'reasonable'}
            options={[
              { value: 'prevailing_corporate', label: 'Prevailing Rate for Corporate Trustees', description: 'In the range of then-prevailing rates charged by corporate trustees.' },
              { value: 'prevailing_professional', label: 'Prevailing Rate for Professional Fiduciaries', description: 'In the range of then-prevailing rates charged by professional fiduciaries.' },
              { value: 'reasonable', label: 'Reasonable Compensation', description: 'Reasonable fee based on time and effort.' },
              { value: 'based_on_trustee_type', label: 'Based on Trustee Type', description: 'If corporate trustee, benchmark to prevailing rates for corporate trustees. If professional fiduciary, benchmark to rates charged by professional fiduciaries. Otherwise, reasonable fee.' },
              { value: 'none', label: 'No Compensation', description: 'Trustee may not receive compensation.' },
            ]}
            onChange={value => updateTrustDetails({ trustee_compensation: value as TrusteeCompensation })}
          />
        </div>

        <div className="mt-6 space-y-3">
          <DesignSheetCheckboxOption
            label="Protect U.S. trust status"
            description="Adds a Foreign Trust Savings Clause to prevent the trust from being treated as a foreign trust for U.S. tax purposes. It prohibits any non-U.S. person or non-U.S. resident from controlling substantial decisions."
            checked={trustDetails.protect_us_trust_status}
            onChange={checked => updateTrustDetails({
              protect_us_trust_status: checked,
              ...(checked ? { allow_special_trustee: true } : {}),
            })}
          />
          <DesignSheetCheckboxOption
            label="Allow Special Trustee"
            description="Allows the trustee to appoint a Special Trustee to exercise powers the trustee cannot exercise. This is always included if domestic trust status protections are enabled."
            checked={trustDetails.allow_special_trustee || trustDetails.protect_us_trust_status}
            onChange={checked => {
              if (trustDetails.protect_us_trust_status && !checked) return
              updateTrustDetails({ allow_special_trustee: checked })
            }}
          />
          {(trustDetails.allow_special_trustee || trustDetails.protect_us_trust_status) && (
            <div>
              <FieldLabel>Special Trustee Instructions (optional)</FieldLabel>
              <p className="mb-2 text-[12px] text-muted-foreground">
                Add additional provisions following the default Special Trustee paragraphs, e.g. to pre-appoint a specific person to serve as Special Trustee over a specific asset or act, like rental property. Leave blank if the Special Trustee provision should only operate as a contingent power.
              </p>
              <Textarea
                value={specialTrusteeInstructions}
                onChange={e => setSpecialTrusteeInstructions(e.target.value)}
                onBlur={() => updateTrustDetails({ special_trustee_instructions: specialTrusteeInstructions.trim() || null })}
                placeholder="Optional special trustee instructions…"
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
          )}
          <DesignSheetCheckboxOption
            label="Power to manage §529 educational savings plans"
            description="Explicitly authorizes the trustee to create, manage, and terminate §529 educational savings plans."
            checked={trustDetails.power_529_plans}
            onChange={checked => updateTrustDetails({ power_529_plans: checked })}
          />
          <DesignSheetCheckboxOption
            label="Power to manage farms and ranches"
            description="Explicitly authorizes the trustee to manage and operate farms, ranches, and similar properties."
            checked={trustDetails.power_farms_ranches}
            onChange={checked => updateTrustDetails({ power_farms_ranches: checked })}
          />
          <DesignSheetCheckboxOption
            label="Power to manage closely held businesses"
            description="Explicitly allows the trustee to manage and operate closely held businesses. Increases the responsibilities of the trustee, but without this power, the trustee may have to sell the business instead."
            checked={trustDetails.power_closely_held_businesses}
            onChange={checked => updateTrustDetails({ power_closely_held_businesses: checked })}
          />
          <DesignSheetCheckboxOption
            label="Power to manage professional corporations"
            description="If the trust owns shares of a professional corporation (e.g. a law firm) that requires a license to own/operate, ensures the trustee can only distribute these shares to a beneficiary who is licensed, and must otherwise sell them and distribute the proceeds."
            checked={trustDetails.power_professional_corporations}
            onChange={checked => updateTrustDetails({ power_professional_corporations: checked })}
          />
          <DesignSheetCheckboxOption
            label="Subchapter S stock provisions"
            description="Authorizes and requires the trustee to handle any subchapter S shares in the trust in a manner that prevents the S Corporation from losing its tax status."
            checked={trustDetails.subchapter_s_provisions}
            onChange={checked => updateTrustDetails({ subchapter_s_provisions: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow trustee to change situs"
            description="Permits the trustee to change the trust's situs."
            checked={trustDetails.allow_trustee_change_situs}
            onChange={checked => updateTrustDetails({ allow_trustee_change_situs: checked })}
          />
          <DesignSheetCheckboxOption
            label="Require bond for trustee"
            description="Requires the trustee to post bond. Most revocable trusts waive it."
            checked={trustDetails.require_trustee_bond}
            onChange={checked => updateTrustDetails({ require_trustee_bond: checked })}
          />
          <DesignSheetCheckboxOption
            label="Limit trustee's duty to account"
            description="Limits formal accounting to the beneficiaries currently entitled to income."
            checked={trustDetails.limit_duty_to_account}
            onChange={checked => updateTrustDetails({ limit_duty_to_account: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include reverse mortgage clause"
            description="Authorises the trustee to obtain, maintain, or pay off a reverse mortgage on trust real estate."
            checked={trustDetails.include_reverse_mortgage_clause}
            onChange={checked => updateTrustDetails({ include_reverse_mortgage_clause: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include firearms administration provisions"
            description="Adds handling and transfer provisions for firearms held in the trust."
            checked={trustDetails.include_firearms_provisions}
            onChange={checked => updateTrustDetails({ include_firearms_provisions: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow a sole acting trustee to appoint co-trustees"
            description="Lets a trustee serving alone add a co-trustee without a court petition."
            checked={trustDetails.allow_sole_trustee_to_appoint_cotrustees}
            onChange={checked => updateTrustDetails({ allow_sole_trustee_to_appoint_cotrustees: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow an acting trustee to designate alternate successor trustees"
            description="Lets an acting trustee name further successors beyond those the settlor listed."
            checked={trustDetails.allow_trustee_to_designate_alternates}
            onChange={checked => updateTrustDetails({ allow_trustee_to_designate_alternates: checked })}
          />
        </div>

        <div className="mt-6 space-y-3">
          <DecisionRow
            question="Successor Trustee Vacancy"
            value={trustDetails.successor_trustee_vacancy ?? ''}
            options={[
              { value: 'income_beneficiaries_any', label: 'Majority of income beneficiaries may appoint any successor trustee' },
              { value: 'income_beneficiaries_professional', label: 'Majority of income beneficiaries may appoint a professional fiduciary or corporate trustee only' },
              { value: 'resigning_neutral', label: 'Resigning trustee may appoint any neutral and disinterested party' },
              { value: 'resigning_professional', label: 'Resigning trustee may appoint a professional fiduciary or corporate trustee only' },
              { value: 'settlor_or_court', label: 'Only the settlor(s) may appoint; if unable, court petition' },
            ]}
            onChange={v => updateTrustDetails({ successor_trustee_vacancy: v as SuccessorTrusteeVacancy })}
          />
        </div>
      </SectionBlock>

      <TrustBeneficiariesSection
        sheet={sheet}
        onChange={onChange}
        contacts={contacts}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
        specificBequestsOnly
      />

      <SectionBlock title="Tangible Personal Property">
        <DecisionRow
          question="Distribution of tangible property"
          fieldName="tangible_property_distribution"
          value={sheet.tangible_property_distribution}
          options={[
            { value: 'spouse_then_children', label: 'Spouse, then children' },
            { value: 'children_then_descendants', label: 'Children, then descendants' },
            { value: 'named_then_children', label: 'Named individual, then children' },
            { value: 'memorandum', label: 'Personal property memorandum' },
          ]}
          onChange={v => onChange('tangible_property_distribution', v)}
        />
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          {sheet.tangible_property_distribution === 'named_then_children' && (
            <AttorneyInput
              fieldName="tangible_property_named_individual"
              label="Named Individual"
              value={sheet.tangible_property_named_individual ?? ''}
              onChange={v => onChange('tangible_property_named_individual', v || null)}
            />
          )}
        </div>
      </SectionBlock>

      <SectionBlock title="Pet Care Provisions">
        <DecisionRow
          question="Pet care provision"
          value={sheet.pet_care_option ?? 'omit'}
          options={[
            { value: 'omit', label: 'Omit (no pets)' },
            { value: 'direct_bequest', label: 'Direct bequest of pet + cash gift to caretaker' },
            { value: 'pet_trust', label: 'Statutory pet trust under M.G.L. c. 203E §408' },
          ]}
          onChange={v => onChange('pet_care_option', v)}
        />

        {sheet.pet_care_option && sheet.pet_care_option !== 'omit' && (
          <div className="mt-4">
            <DecisionRow
              question="Include pet care provision in"
              value={pet.document}
              options={documentOptions}
              onChange={v => updatePet({ document: v as PetCareDetails['document'] })}
            />
          </div>
        )}

        {sheet.pet_care_option === 'direct_bequest' && (
          <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
            <div>
              <FieldLabel>Cash Amount</FieldLabel>
              <Input
                type="number"
                value={pet.cash_amount ?? ''}
                onChange={e => updatePet({ cash_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                className="h-9 text-sm"
              />
            </div>
            <AttorneyInput label="Primary Caretaker" value={pet.primary_caretaker ?? ''} onChange={v => updatePet({ primary_caretaker: v || null })} />
            <AttorneyInput label="Successor Caretaker" value={pet.successor_caretaker ?? ''} onChange={v => updatePet({ successor_caretaker: v || null })} />
          </div>
        )}

        {sheet.pet_care_option === 'pet_trust' && (
          <div className="mt-3">
            <ClientDecisionCallout>Pet trust enforcer is required and easy to forget.</ClientDecisionCallout>
          </div>
        )}
        {sheet.pet_care_option === 'pet_trust' && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <FieldLabel>Cash Amount</FieldLabel>
              <Input
                type="number"
                value={pet.cash_amount ?? ''}
                onChange={e => updatePet({ cash_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                className="h-9 text-sm"
              />
            </div>
            <AttorneyInput label="Pet Trustee" value={pet.pet_trustee ?? ''} onChange={v => updatePet({ pet_trustee: v || null })} />
            <AttorneyInput label="Remainder Beneficiary" value={pet.remainder_beneficiary ?? ''} onChange={v => updatePet({ remainder_beneficiary: v || null })} />
            <AttorneyInput label="Pet Trust Enforcer" value={pet.enforcer ?? ''} onChange={v => updatePet({ enforcer: v || null })} />
          </div>
        )}
      </SectionBlock>

      <SectionBlock title="Residuary Distribution">
        <DecisionRow
          question="Residual beneficiary"
          value={sheet.residual_beneficiary}
          options={[
            { value: 'children', label: 'Children' },
            { value: 'descendants', label: 'Descendants' },
            { value: 'named', label: 'Named individuals' },
          ]}
          onChange={v => onChange('residual_beneficiary', v)}
        />
        <DecisionRow
          question="Residual Beneficiary Method"
          help="Choose how the residuary share is distributed or held."
          fieldName="residual_beneficiary_method"
          blocking
          value={residualMethod}
          options={RESIDUAL_BENEFICIARY_METHOD_OPTIONS}
          // trust_details is the only home for this decision. It was once written to a
          // parallel `distribution_method` column too, and the two drifted; that column
          // has since been backfilled into trust_details and dropped.
          onChange={method => updateTrustDetails({ residual_beneficiary_method: method })}
        />

        <div className="mt-4">
          <DecisionRow
            question={deathLabel}
            value={trustDetails.residuary_after_death}
            options={[
              { value: 'descendants_outright_per_stirpes', label: 'Distributed outright to descendants, per stirpes.' },
              { value: 'descendants_shares_outright_children_trusts_others', label: "Divided into shares for descendants, per stirpes, to be distributed outright to children of the Grantor and held in trusts for others." },
              { value: 'descendants_shares_all_trusts', label: "Divided into shares, per stirpes, each share held in trust. State the terms of the trust once and apply to all descendants' trusts." },
              { value: 'named_beneficiaries_separate_terms', label: 'Divided into shares for named beneficiaries. Separately state terms of administration and distribution for each beneficiary.' },
            ]}
            onChange={value => updateTrustDetails({ residuary_after_death: value as ResiduaryAfterDeath })}
          />
        </div>

        {sheet.residual_beneficiary === 'named' && (
          <div className="mt-4">
            <FieldLabel>Named Individuals</FieldLabel>
            <div className="space-y-2">
              {residualIndividuals.map((id, i) => (
                <DesignContactPicker
                  key={`${id}-${i}`}
                  role="Named Individual"
                  value={residualContactById(id)}
                  contacts={pickerContacts}
                  onAddContact={adaptAdd}
                  onUpdateContact={adaptUpdate}
                  onChange={c =>
                    c
                      ? setResidualIndividuals(residualIndividuals.map((x, idx) => (idx === i ? c.id : x)))
                      : setResidualIndividuals(residualIndividuals.filter((_, idx) => idx !== i))
                  }
                />
              ))}
              <DesignContactPicker
                role="Add a named individual"
                value={null}
                contacts={pickerContacts}
                onAddContact={adaptAdd}
                onUpdateContact={adaptUpdate}
                onChange={c => { if (c) setResidualIndividuals([...residualIndividuals, c.id]) }}
              />
            </div>
          </div>
        )}

        {residualMethod === 'outright' && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <AttorneyInput
              fieldName="distribution_age"
              label="Final Distribution Age"
              value={sheet.distribution_age?.toString() ?? ''}
              placeholder="e.g. 30"
              onChange={v => onChange('distribution_age', parseInt(v) || null)}
            />
          </div>
        )}

        {residualMethod === 'staggered' && (
          <div className="mt-4">
            <FieldLabel>Staggered Distributions</FieldLabel>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Quick fill:</span>
              {STAGGERED_DISTRIBUTION_PRESETS.map(preset => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setStaggers(buildStaggeredTiersFromPreset(preset, () => crypto.randomUUID()))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {staggers.length > 0 && (
              <div className="space-y-2">
                {staggers.map((t, i) => (
                  <div key={t.id ?? i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                    <AttorneyInput label="Amount" value={t.amount ?? ''} placeholder="e.g. 1/3" onChange={v => editStagger(i, { amount: v || null })} />
                    <AttorneyInput label="Age" value={t.age?.toString() ?? ''} placeholder="e.g. 25" onChange={v => editStagger(i, { age: parseInt(v) || null })} />
                    <Button variant="ghost" size="sm" className="mb-0.5 h-9 px-2 text-destructive hover:text-destructive" onClick={() => removeStagger(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button variant="outline" size="sm" className="mt-2 gap-1.5 text-xs" onClick={addStagger}>
              <Plus className="h-3.5 w-3.5" />
              Add Distribution
            </Button>
          </div>
        )}

        <div className="mt-6">
          <DesignSheetCheckboxOption
            label="Include provisions for a common trust for Grantor's children?"
            checked={trustDetails.include_common_trust_for_children}
            onChange={checked => updateTrustDetails({ include_common_trust_for_children: checked })}
          />
        </div>

        <div className="mt-6 space-y-3">
          <FieldLabel>Special Distributions</FieldLabel>
          <div className="space-y-3">
            <DesignSheetCheckboxOption
              label="Special Distributions Age"
              description="Beneficiaries under this age may (at the trustee's discretion) have their inheritance applied for their benefit rather than paid directly."
              checked={trustDetails.special_distributions_age != null}
              onChange={checked => updateTrustDetails({ special_distributions_age: checked ? 25 : null })}
            />
            {trustDetails.special_distributions_age != null && (
              <AttorneyInput
                label="Age (years old)"
                value={trustDetails.special_distributions_age?.toString() ?? ''}
                placeholder="e.g. 25"
                onChange={v => updateTrustDetails({ special_distributions_age: parseInt(v) || null })}
              />
            )}
          </div>
          <DesignSheetCheckboxOption
            label="Allow trustee to hold distributions to young beneficiaries in trust"
            description="Permits the trustee to establish and fund a separate trust for the benefit of a minor or young beneficiary (as defined by the Special Distributions age above), rather than distributing assets directly."
            checked={trustDetails.hold_distributions_for_young_beneficiaries}
            onChange={checked => updateTrustDetails({ hold_distributions_for_young_beneficiaries: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include substance abuse provisions"
            description="Adds provisions allowing the trustee to request examination, suspend distributions, and pay for treatment if a beneficiary is routinely using illegal substances or is clinically dependent on alcohol or legal substances."
            checked={trustDetails.include_substance_abuse || yesNoField(sheet.provision_substance_abuse)}
            onChange={checked => {
              updateTrustDetails({ include_substance_abuse: checked })
              onChange('provision_substance_abuse', toYesNo(checked))
            }}
          />
          <DesignSheetCheckboxOption
            label="Include creditor claims and divorce provisions"
            description="Add additional provisions to protect trust assets from beneficiaries' creditors and in the event of a beneficiary's divorce. This allows the trustee to suspend distributions until the judgment or claims are resolved."
            checked={trustDetails.include_creditor_divorce_provisions || yesNoField(sheet.provision_married_beneficiary)}
            onChange={checked => {
              updateTrustDetails({ include_creditor_divorce_provisions: checked })
              onChange('provision_married_beneficiary', toYesNo(checked))
            }}
          />
          {autoMaritalDeductionSavings ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
              <span className="font-medium">Include marital deduction savings language in spendthrift clause</span>
              <p className="mt-0.5 text-xs text-muted-foreground">This language is required for this trust structure and will be included automatically.</p>
            </div>
          ) : (
            <DesignSheetCheckboxOption
              label="Include marital deduction savings language in spendthrift clause"
              description="Adds marital deduction savings language to the spendthrift clause. Disclaimer and Clayton-election structures include it automatically."
              checked={trustDetails.include_marital_deduction_savings_language}
              onChange={checked => updateTrustDetails({ include_marital_deduction_savings_language: checked })}
            />
          )}
          <DesignSheetCheckboxOption
            label="Include contingent special needs trust provisions"
            description="Adds a contingent special needs trust (SNT) for any beneficiary who is receiving public benefits at the time of distribution."
            checked={trustDetails.include_contingent_snt}
            onChange={checked => updateTrustDetails({ include_contingent_snt: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow the trustee to make distributions to dependents if settlor(s) are incapacitated"
            description="This may be used to provide for people dependent on the settlor(s) for financial support during a period of incapacity."
            checked={trustDetails.allow_distributions_to_dependents_if_incapacitated}
            onChange={checked => updateTrustDetails({ allow_distributions_to_dependents_if_incapacitated: checked })}
          />
        </div>
      </SectionBlock>

      <TrustBeneficiariesSection
        sheet={sheet}
        onChange={onChange}
        contacts={contacts}
        onAddContact={onAddContact}
        onUpdateContact={onUpdateContact}
        remoteBeneficiariesOnly
      />

      <SectionBlock title="Administrative Provisions">
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="Include a no-contest clause in the trust and pour-over will"
            description="Include a 'No Contest' clause in the trust (and pour-over will). This clause discourages beneficiaries from challenging the trust or will, but may not be enforceable."
            checked={trustDetails.include_no_contest_clause || sheet.no_contest_clause === 'include'}
            onChange={checked => {
              updateTrustDetails({ include_no_contest_clause: checked })
              onChange('no_contest_clause', checked ? 'include' : 'omit')
            }}
          />
          <DesignSheetCheckboxOption
            label="Name specific people in the no-contest clause"
            description="Naming specific people makes it more likely that certain states will enforce the no-contest clause."
            checked={trustDetails.name_people_in_no_contest_clause}
            onChange={checked => updateTrustDetails({ name_people_in_no_contest_clause: checked })}
          />
          <DesignSheetCheckboxOption
            label="Require mandatory arbitration for trust disputes"
            description="Include the requirement of mandatory arbitration for conflict resolution instead of litigation. Enforceability varies by jurisdiction."
            checked={trustDetails.require_mandatory_arbitration}
            onChange={checked => updateTrustDetails({ require_mandatory_arbitration: checked })}
          />
          <DesignSheetCheckboxOption
            label="Prorate estate taxes among beneficiaries"
            description="Pro-rate the estate tax (if any) between all of the beneficiaries, instead of having the trust pay the estate tax before distribution."
            checked={trustDetails.prorate_estate_taxes}
            onChange={checked => updateTrustDetails({ prorate_estate_taxes: checked })}
          />
          <DecisionRow
            question="Representation type"
            help="How shares pass to descendants when a beneficiary predeceases."
            value={trustDetails.representation_type}
            options={[
                { value: 'by_representation', label: 'By right of representation' },
                { value: 'per_stirpes', label: 'Per stirpes' },
                { value: 'per_capita_each_generation', label: 'Per capita at each generation' },
            ]}
            onChange={value => updateTrustDetails({ representation_type: value as RepresentationType })}
          />
          <AttorneyInput
            label="Survivorship Requirement (days)"
            value={trustDetails.survivorship_requirement_days?.toString() ?? ''}
            placeholder="e.g. 30"
            onChange={v => updateTrustDetails({ survivorship_requirement_days: parseInt(v) || null })}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Definitions">
        <div className="space-y-3">
          <DesignSheetCheckboxOption
            label="Include detailed definition of discretionary distributions"
            description='If selected, includes a definition of "Discretionary Distribution" in the trust.'
            checked={trustDetails.include_discretionary_distribution_definition}
            onChange={checked => updateTrustDetails({ include_discretionary_distribution_definition: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include detailed definition of education expenses"
            description="Specifies what educational expenses the trustee can pay for, such as tuition, books, room and board, etc."
            checked={trustDetails.include_education_expenses_definition}
            onChange={checked => updateTrustDetails({ include_education_expenses_definition: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include arts education in approved educational expenses"
            description="Allows the trustee to pay for fine arts, music, dance, and other artistic educational pursuits."
            checked={trustDetails.include_arts_education}
            onChange={checked => updateTrustDetails({ include_arts_education: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include vocational training in approved educational expenses"
            description="Allows the trustee to pay for trade schools, apprenticeships, and other vocational training programs."
            checked={trustDetails.include_vocational_training}
            onChange={checked => updateTrustDetails({ include_vocational_training: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include homeschooling in approved educational expenses"
            description="Allows the trustee to pay for homeschooling of a minor beneficiary conducted as part of a regular course of study, whether provided by a parent, guardian, tutor, teacher, online program, or homeschool cooperative."
            checked={trustDetails.include_homeschooling}
            onChange={checked => updateTrustDetails({ include_homeschooling: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include definition of disappearance"
            description="Specifies when someone is legally considered missing or disappeared, which can affect trust administration and distributions."
            checked={trustDetails.include_disappearance_definition}
            onChange={checked => updateTrustDetails({ include_disappearance_definition: checked })}
          />
        </div>
        <div className="mt-6">
          <DecisionRow
            question="Parent-child relationships"
            help="How the documents decide who counts as a parent and a child. A custom definition is for families where the probate code's answer is not the one they want — adopted adults, stepchildren, children of assisted reproduction."
            fieldName="trust_details.parent_child_relationship_definition"
            value={trustDetails.parent_child_relationship_definition ?? ''}
            options={[
              { value: 'state_probate_code', label: 'State Probate Code', description: "The Massachusetts default." },
              { value: 'custom', label: 'Custom Definition', description: 'Drafted for this family.' },
            ]}
            onChange={value => updateTrustDetails({
              parent_child_relationship_definition:
                (value || null) as ParentChildRelationshipDefinition | null,
            })}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Retirement Accounts, Gifts and Protections">
        <div className="mt-6 space-y-3">
          <DesignSheetCheckboxOption
            label="Include provisions for distributing retirement accounts"
            description="Adds conduit and accumulation provisions for retirement accounts payable to the trust."
            checked={trustDetails.include_retirement_account_provisions}
            onChange={checked => updateTrustDetails({ include_retirement_account_provisions: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow Trust Protector to convert conduit retirement trusts"
            description="Lets the trust protector convert a conduit retirement trust to an accumulation trust as the tax rules change."
            checked={trustDetails.allow_protector_convert_conduit_trusts}
            onChange={checked => updateTrustDetails({ allow_protector_convert_conduit_trusts: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow direct distributions to young or incapacitated beneficiaries"
            description="Permits payment to a parent, guardian, or custodian rather than to the beneficiary directly."
            checked={trustDetails.allow_direct_distributions_to_young_or_incapacitated}
            onChange={checked => updateTrustDetails({ allow_direct_distributions_to_young_or_incapacitated: checked })}
          />
          <DesignSheetCheckboxOption
            label="Include slayer provision (disqualification for wrongful killing)"
            description="Disqualifies any beneficiary who feloniously and intentionally causes a settlor\u2019s death."
            checked={trustDetails.include_slayer_provision}
            onChange={checked => updateTrustDetails({ include_slayer_provision: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow the trustee to continue customary charitable giving during incapacity"
            description="Lets the trustee keep up a settlor's established pattern of charitable gifts while they are incapacitated."
            checked={trustDetails.allow_charitable_giving_during_incapacity}
            onChange={checked => updateTrustDetails({ allow_charitable_giving_during_incapacity: checked })}
          />
          <DesignSheetCheckboxOption
            label="Forgive all debts owed by any beneficiary"
            description="Forgives outstanding debts a beneficiary owes the settlor rather than charging them against a share."
            checked={trustDetails.forgive_all_debts}
            onChange={checked => updateTrustDetails({ forgive_all_debts: checked })}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Incapacity">
        <div className="mt-6 space-y-3">
          <DesignSheetCheckboxOption
            label="Include definition of incapacity"
            description="Defines incapacity in the trust rather than relying on the probate code default."
            checked={trustDetails.include_incapacity_definition}
            onChange={checked => updateTrustDetails({ include_incapacity_definition: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow clinical psychologist to substitute for physician"
            description="A licensed clinical psychologist may make a determination the trust otherwise assigns to a physician."
            checked={trustDetails.allow_psychologist_substitute}
            onChange={checked => updateTrustDetails({ allow_psychologist_substitute: checked })}
          />
          <DesignSheetCheckboxOption
            label="Allow physician assistant or nurse practitioner to substitute for physician"
            description="A physician assistant or nurse practitioner may make a determination the trust otherwise assigns to a physician."
            checked={trustDetails.allow_pa_np_substitute}
            onChange={checked => updateTrustDetails({ allow_pa_np_substitute: checked })}
          />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <AttorneySelect
            fieldName="settlor_incapacity_determined_by"
            label="Incapacity of a settlor is determined by"
            value={trustDetails.settlor_incapacity_determined_by ?? ''}
            placeholder="Select..."
            options={SETTLOR_INCAPACITY_DETERMINER_OPTIONS}
            onChange={value => updateTrustDetails({
              settlor_incapacity_determined_by: (value || null) as SettlorIncapacityDeterminer | null,
            })}
          />
          <AttorneySelect
            fieldName="trustee_incapacity_determined_by"
            label="Incapacity of an acting trustee is determined by"
            value={trustDetails.trustee_incapacity_determined_by ?? ''}
            placeholder="Select..."
            options={TRUSTEE_INCAPACITY_DETERMINER_OPTIONS}
            onChange={value => updateTrustDetails({
              trustee_incapacity_determined_by: (value || null) as TrusteeIncapacityDeterminer | null,
            })}
          />
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}

export function TrustDocumentSection(props: DocumentSectionProps) {
  return <TrustDetailsSection {...props} scope="client" />
}

export function TrustDetailsSpouseSection(props: DocumentSectionProps) {
  return <TrustDetailsSection {...props} scope="spouse" />
}
