'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { deriveTrustName, deriveSpouseTrustName } from '@/lib/designSheetDefaults'
import {
  getTrustPlanningType,
  setTrustPlanningType,
  type TrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import {
  buildTrustNameSuggestions,
  getTrustDetails,
  getTrustNameFormat,
  setTrustDetails,
  setTrustNameFormat,
  type InitialTrusteeNomination,
  type RepresentationType,
  type ResidualBeneficiaryMethod,
  type ResiduaryAfterDeath,
  type SuccessorTrusteeVacancy,
  type TrustCoTrusteeDecision,
  type TrusteeCompensation,
} from '@/lib/designSheetTrustDetails'
import { applyTrusteeNominationsFromSheet, nominationOptionsForContext } from '@/lib/designSheet/initialTrusteeNomination'
import type { DesignSheet, MatterContact, PetCareDetails, PipelineMatter, StaggeredTier } from '@/types/database'
import DesignContactPicker, { type Contact as PickerContact } from './ContactPicker'
import type { SectionProps } from './shared'
import {
  AttorneyInput,
  AttorneySelect,
  ClientDecisionCallout,
  DesignSheetCheckboxOption,
  FieldHelpLabel,
  FieldLabel,
  DesignSectionContent,
  PrefilledInput,
  SectionBlock,
  toYesNo,
  yesNoField,
} from './shared'
import {
  SegControl,
  findClientContact,
  findSpouseContact,
  isMarriedSheet as isMarried,
} from './fiduciary-blocks'
import { TrustBeneficiariesSection } from './TrustBeneficiariesSection'
import { TrustFiduciarySections } from './documentFiduciarySections'

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
]

function SectionHelp({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800/40 dark:bg-blue-950/20">
      <p className="text-[11px] text-blue-700 dark:text-blue-300">{children}</p>
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
      <FieldHelpLabel help="Controls how the trust name will appear on deeds and other transfer documents.">
        Trust Name Format
      </FieldHelpLabel>
      <DesignSheetCheckboxOption
        label='Use "U/A dated"'
        description='e.g., THE SMITH TRUST, U/A dated January 15, 2025'
        checked={format.date_style === 'ua_dated'}
        onChange={checked => { if (checked) update({ date_style: 'ua_dated' }) }}
      />
      <DesignSheetCheckboxOption
        label='Use "dated" only'
        description='e.g., THE SMITH TRUST dated January 15, 2025'
        checked={format.date_style === 'dated_only'}
        onChange={checked => { if (checked) update({ date_style: 'dated_only' }) }}
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

export function TrustDetailsSection(props: DocumentSectionProps & { scope?: 'client' | 'spouse' }) {
  const { sheet, onChange, contacts, matter, scope = 'client' } = props
  const { onAddContact, onUpdateContact } = props
  const clientContact = findClientContact(contacts, matter, sheet)
  const spouseContact = isMarried(sheet) ? findSpouseContact(contacts, matter, sheet) : null
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
    const spouseNominationOptions = nominationOptionsForContext({
      married,
      jointTrust: Boolean(sheet.is_joint),
      scope: 'spouse',
      clientFirst,
      spouseFirst,
    })

    const handleSpouseNominationChange = (value: string) => {
      const nomination = (value || null) as InitialTrusteeNomination | null
      onChange('decisions', prevSheet => setTrustDetails(prevSheet, { spouse_initial_trustee_nomination: nomination }))
      onChange('spouse_trustee_slots', prevSheet => {
        const nextTrustDetails = {
          ...getTrustDetails(prevSheet),
          spouse_initial_trustee_nomination: nomination,
        }
        const slotPatch = applyTrusteeNominationsFromSheet(
          prevSheet,
          nextTrustDetails,
          clientContact,
          spouseContact,
        )
        return slotPatch.spouse_trustee_slots ?? prevSheet.spouse_trustee_slots
      })
    }

    return (
      <DesignSectionContent>
        <SectionHelp>Configure the spouse&apos;s separate trust name and trustee nominations.</SectionHelp>
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
                suggestions={[
                  `The ${spouseFirst || 'Spouse'} Trust`,
                  `The ${spouseFirst || 'Spouse'} Revocable Trust`,
                ]}
                onSelect={v => onChange('spouse_trust_name', v)}
              />
            </div>
            <TrustNameFormatFields sheet={sheet} onChange={onChange} scope="spouse" />
          </div>
        </SectionBlock>

        {separate && (
          <SectionBlock title="Trustee Provisions">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <AttorneySelect
                label={`${spouseFirst || 'Spouse'}'s Initial Trustee Nomination Structure`}
                value={trustDetails.spouse_initial_trustee_nomination ?? ''}
                placeholder="Select…"
                options={spouseNominationOptions}
                onChange={handleSpouseNominationChange}
              />
            </div>
            <div className="mt-4">
              <TrustFiduciarySections {...props} scope="spouse" trusteesOnly />
            </div>
          </SectionBlock>
        )}

        {!separate && <TrustFiduciarySections {...props} scope="spouse" />}
      </DesignSectionContent>
    )
  }

  const nominationLabel = married
    ? sheet.is_joint
      ? 'Initial Trustee Nomination Structure'
      : `${clientFirst || 'Client'}'s Initial Trustee Nomination Structure`
    : `${clientFirst || 'Client'} Initial Trustee Nomination Structure`

  const nominationOptions = nominationOptionsForContext({
    married,
    jointTrust: Boolean(sheet.is_joint),
    scope: married ? 'client' : 'single',
    clientFirst,
    spouseFirst,
  })

  const handleClientNominationChange = (value: string) => {
    const nomination = (value || null) as InitialTrusteeNomination | null
    onChange('decisions', prevSheet => setTrustDetails(prevSheet, { initial_trustee_nomination: nomination }))
    onChange('trustee_slots', prevSheet => {
      const nextTrustDetails = {
        ...getTrustDetails(prevSheet),
        initial_trustee_nomination: nomination,
      }
      const slotPatch = applyTrusteeNominationsFromSheet(
        prevSheet,
        nextTrustDetails,
        clientContact,
        spouseContact,
      )
      return slotPatch.trustee_slots ?? prevSheet.trustee_slots
    })
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

  const residualMethod = trustDetails.residual_beneficiary_method
    ?? (sheet.distribution_method as ResidualBeneficiaryMethod | null)
  const deathLabel = married
    ? `Following the death of ${clientFirst || 'Client'} and ${spouseFirst || 'Spouse'}, the remaining trust property shall be:`
    : `Following the death of ${clientFirst || 'Client'}, the remaining trust property shall be:`

  return (
    <DesignSectionContent>
      <SectionHelp>Configure the trust structure, name, protector, trustees, and how the residuary is distributed.</SectionHelp>

      <SectionBlock title="Trust Structure">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Joint Trust?</FieldLabel>
            <SegControl value={sheet.is_joint ? 'yes' : 'no'} options={YES_NO} onChange={v => onChange('is_joint', v === 'yes')} />
          </div>
        </div>
        {married && !sheet.is_joint && (
          <div className="mt-4 space-y-3">
            <FieldLabel>Spousal Trust Funding</FieldLabel>
            {SPOUSAL_TRUST_FUNDING_OPTIONS.map(option => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Checkbox
                  checked={spousalFunding === option.value}
                  onCheckedChange={checked => {
                    if (checked) onChange('decisions', prevSheet => setTrustPlanningType(prevSheet, option.value))
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
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
                suggestions={[
                  `The ${spouseFirst || 'Spouse'} Trust`,
                  `The ${spouseFirst || 'Spouse'} Revocable Trust`,
                ]}
                onSelect={v => onChange('spouse_trust_name', v)}
              />
            </div>
            <TrustNameFormatFields sheet={sheet} onChange={onChange} scope="spouse" />
          </div>
        )}
      </SectionBlock>

      <SectionBlock title="Restatement">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Restatement"
            value={sheet.restatement ? 'yes' : 'no'}
            options={[
              { value: 'yes', label: 'Yes - Restating existing trust' },
              { value: 'no', label: 'No - New trust' },
            ]}
            onChange={v => onChange('restatement', v === 'yes')}
          />
        </div>
      </SectionBlock>

      <SectionBlock title="Trust Protector">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Include Trust Protector"
            value={sheet.trust_protector ? 'yes' : 'no'}
            options={YES_NO}
            onChange={v => onChange('trust_protector', v === 'yes')}
          />
          {sheet.trust_protector && (
            <AttorneyInput
              label="Trust Protector Full Name"
              value={sheet.trust_protector_name ?? ''}
              onChange={v => onChange('trust_protector_name', v || null)}
            />
          )}
        </div>
      </SectionBlock>

      <SectionBlock title="Trustee Provisions" subtitle="Drives how trustee slots are nominated in the trust">
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <AttorneySelect
            label={nominationLabel}
            value={trustDetails.initial_trustee_nomination ?? ''}
            placeholder="Select…"
            options={nominationOptions}
            onChange={handleClientNominationChange}
          />
        </div>

        <div className="mt-4">
          <TrustFiduciarySections {...props} scope="client" trusteesOnly />
        </div>

        {separate && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <AttorneySelect
                label={`${spouseFirst || 'Spouse'}'s Initial Trustee Nomination Structure`}
                value={trustDetails.spouse_initial_trustee_nomination ?? ''}
                placeholder="Select…"
                options={nominationOptionsForContext({
                  married,
                  jointTrust: false,
                  scope: 'spouse',
                  clientFirst,
                  spouseFirst,
                })}
                onChange={value => {
                  const nomination = (value || null) as InitialTrusteeNomination | null
                  onChange('decisions', prevSheet => setTrustDetails(prevSheet, { spouse_initial_trustee_nomination: nomination }))
                  onChange('spouse_trustee_slots', prevSheet => {
                    const nextTrustDetails = {
                      ...getTrustDetails(prevSheet),
                      spouse_initial_trustee_nomination: nomination,
                    }
                    const slotPatch = applyTrusteeNominationsFromSheet(
                      prevSheet,
                      nextTrustDetails,
                      clientContact,
                      spouseContact,
                    )
                    return slotPatch.spouse_trustee_slots ?? prevSheet.spouse_trustee_slots
                  })
                }}
              />
            </div>
            <TrustFiduciarySections {...props} scope="spouse" trusteesOnly />
          </div>
        )}

        <div className="mt-6 space-y-3">
          <FieldLabel>If the trust ever has co-trustees, how should they make decisions?</FieldLabel>
          {([
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
          ] as const).map(option => (
            <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <Checkbox
                checked={(trustDetails.co_trustee_decision ?? 'joint_majority') === option.value}
                onCheckedChange={checked => {
                  if (checked) updateTrustDetails({ co_trustee_decision: option.value as TrustCoTrusteeDecision })
                }}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-6">
          <FieldLabel>Trustee Compensation</FieldLabel>
          <div className="space-y-3">
            {([
              { value: 'prevailing_corporate', label: 'Prevailing Rate for Corporate Trustees', description: 'In the range of then-prevailing rates charged by corporate trustees.' },
              { value: 'prevailing_professional', label: 'Prevailing Rate for Professional Fiduciaries', description: 'In the range of then-prevailing rates charged by professional fiduciaries.' },
              { value: 'reasonable', label: 'Reasonable Compensation', description: 'Reasonable fee based on time and effort.' },
              { value: 'based_on_trustee_type', label: 'Based on Trustee Type', description: 'If corporate trustee, benchmark to prevailing rates for corporate trustees. If professional fiduciary, benchmark to rates charged by professional fiduciaries. Otherwise, reasonable fee.' },
              { value: 'none', label: 'No Compensation', description: 'Trustee may not receive compensation.' },
            ] as const).map(option => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Checkbox
                  checked={(trustDetails.trustee_compensation ?? 'reasonable') === option.value}
                  onCheckedChange={checked => {
                    if (checked) updateTrustDetails({ trustee_compensation: option.value as TrusteeCompensation })
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
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
        </div>

        <div className="mt-6 space-y-3">
          <FieldLabel>Filling a Vacancy</FieldLabel>
          <AttorneySelect
            label="Successor Trustee Vacancy"
            value={trustDetails.successor_trustee_vacancy ?? ''}
            placeholder="Select…"
            options={[
              { value: 'income_beneficiaries_any', label: 'Majority of income beneficiaries may appoint any successor trustee' },
              { value: 'income_beneficiaries_professional', label: 'Majority of income beneficiaries may appoint a professional fiduciary or corporate trustee only' },
              { value: 'resigning_neutral', label: 'Resigning trustee may appoint any neutral and disinterested party' },
              { value: 'resigning_professional', label: 'Resigning trustee may appoint a professional fiduciary or corporate trustee only' },
              { value: 'settlor_or_court', label: 'Only the settlor(s) may appoint; if unable, court petition' },
            ]}
            onChange={v => updateTrustDetails({ successor_trustee_vacancy: (v || null) as SuccessorTrusteeVacancy | null })}
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            fieldName="tangible_property_distribution"
            label="Distribution of Tangible Property"
            value={sheet.tangible_property_distribution ?? ''}
            placeholder="Select..."
            options={[
              { value: 'spouse_then_children', label: 'Spouse, then children' },
              { value: 'children_then_descendants', label: 'Children, then descendants' },
              { value: 'named_then_children', label: 'Named individual, then children' },
              { value: 'memorandum', label: 'Personal property memorandum' },
            ]}
            onChange={v => onChange('tangible_property_distribution', v || null)}
          />
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
        <AttorneySelect
          label="Pet Care Provision"
          value={sheet.pet_care_option ?? 'omit'}
          options={[
            { value: 'omit', label: 'Omit (no pets)' },
            { value: 'direct_bequest', label: 'Direct bequest of pet + cash gift to caretaker' },
            { value: 'pet_trust', label: 'Statutory pet trust under M.G.L. c. 203E §408' },
          ]}
          onChange={v => onChange('pet_care_option', v as 'omit' | 'direct_bequest' | 'pet_trust')}
        />

        {sheet.pet_care_option && sheet.pet_care_option !== 'omit' && (
          <div className="mt-4 grid grid-cols-2 gap-x-6">
            <AttorneySelect
              label="In document"
              value={pet.document ?? ''}
              placeholder="Select..."
              options={documentOptions}
              onChange={v => updatePet({ document: (v || null) as PetCareDetails['document'] })}
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Residual Beneficiary"
            value={sheet.residual_beneficiary ?? ''}
            placeholder="Select..."
            options={[
              { value: 'children', label: 'Children' },
              { value: 'descendants', label: 'Descendants' },
              { value: 'named', label: 'Named individuals' },
            ]}
            onChange={v => onChange('residual_beneficiary', v || null)}
          />
          <AttorneySelect
            label="Residual Beneficiary Method"
            value={residualMethod ?? ''}
            placeholder="Select..."
            options={[
              { value: 'outright', label: 'Outright' },
              { value: 'staggered', label: 'Staggered (e.g. 1/3 at 25, 30, 35)' },
              { value: 'trust-for-life', label: 'Held in trust for lifetime' },
              { value: 'custom', label: 'Custom distribution schedule' },
            ]}
            onChange={v => {
              const method = (v || null) as ResidualBeneficiaryMethod | null
              updateTrustDetails({ residual_beneficiary_method: method })
              onChange('distribution_method', method)
            }}
          />
        </div>

        <div className="mt-4">
          <FieldLabel>{deathLabel}</FieldLabel>
          <div className="space-y-3">
            {([
              { value: 'descendants_outright_per_stirpes', label: 'Distributed outright to descendants, per stirpes.' },
              { value: 'descendants_shares_outright_children_trusts_others', label: "Divided into shares for descendants, per stirpes, to be distributed outright to children of the Grantor and held in trusts for others." },
              { value: 'descendants_shares_all_trusts', label: "Divided into shares, per stirpes, each share held in trust. State the terms of the trust once and apply to all descendants' trusts." },
              { value: 'named_beneficiaries_separate_terms', label: 'Divided into shares for named beneficiaries. Separately state terms of administration and distribution for each beneficiary.' },
            ] as const).map(option => (
              <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Checkbox
                  checked={trustDetails.residuary_after_death === option.value}
                  onCheckedChange={checked => {
                    if (checked) updateTrustDetails({ residuary_after_death: option.value as ResiduaryAfterDeath })
                  }}
                  className="mt-0.5"
                />
                <span className="text-sm leading-relaxed text-foreground">{option.label}</span>
              </label>
            ))}
          </div>
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
              description="Adds marital deduction savings language to the spendthrift clause when selected for this trust structure."
              checked={false}
              onChange={() => {}}
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
          <div>
            <FieldLabel>Representation Type</FieldLabel>
            <p className="mb-2 text-xs text-muted-foreground">How shares pass to descendants when a beneficiary predeceases.</p>
            <div className="space-y-3">
              {([
                { value: 'by_representation', label: 'By right of representation' },
                { value: 'per_stirpes', label: 'Per stirpes' },
                { value: 'per_capita_each_generation', label: 'Per capita at each generation' },
              ] as const).map(option => (
                <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <Checkbox
                    checked={trustDetails.representation_type === option.value}
                    onCheckedChange={checked => {
                      if (checked) updateTrustDetails({ representation_type: option.value as RepresentationType })
                    }}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-foreground">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
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
