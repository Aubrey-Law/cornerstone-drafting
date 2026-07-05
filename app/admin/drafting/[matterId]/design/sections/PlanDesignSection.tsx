'use client'

import { Plus, Trash2 } from 'lucide-react'
import { DocumentPicker } from '@/components/guided/DocumentPicker'
import { PlanStructurePicker } from '@/components/guided/PlanStructurePicker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { DesignSheet, MatterContact, PetCareDetails } from '@/types/database'
import {
  type DesignDocumentKey,
  getDocumentInclusions,
  getTrustPlanningType,
  setDocumentInclusion,
  setTrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'
import {
  DESIGN_PLAN_TYPE_OPTIONS,
  normalizeDesignPlanType,
} from '@/lib/designPlanType'
import { Input } from '@/components/ui/input'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  AttorneySelect,
  ClientDecisionCallout,
  FieldLabel,
  SectionBlock,
  type SectionProps,
} from './shared'

interface PlanDesignSectionProps extends SectionProps {
  contacts?: MatterContact[]
  onAddContact?: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  /** LP only — current plan coverage and a setter. Omitted for EP matters. */
  isLP?: boolean
  planCoverage?: 'no_trust' | 'trust_included'
  onPlanCoverageChange?: (coverage: 'no_trust' | 'trust_included') => void
}

export function PlanDesignSection({ sheet, onChange, contacts = [], onAddContact, onUpdateContact, isLP = false, planCoverage = 'no_trust', onPlanCoverageChange }: PlanDesignSectionProps) {
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const inclusions = getDocumentInclusions(sheet)
  const needsDistributionMethod = !sheet.distribution_method
  const isMarried = (sheet.marital_status ?? '').toLowerCase().includes('married')
  // The disclaimer trust is an individual (non-joint) structure for a married
  // client, so only offer it when a spouse exists, the trust is included, and
  // the plan is not a joint trust.
  const showDisclaimerToggle = isMarried && inclusions.trust && !sheet.is_joint
  const isDisclaimerTrust = getTrustPlanningType(sheet) === 'disclaimer'

  const updateDocument = (key: keyof typeof inclusions, checked: boolean) => {
    onChange('decisions', setDocumentInclusion(sheet, key, checked))
  }

  const clientFirst = (sheet.client_name ?? '').trim().split(/\s+/)[0] || ''
  const documentOptions = [
    { value: 'will', label: 'Will' },
    { value: 'trust', label: 'Trust' },
  ]

  const pet: PetCareDetails = sheet.pet_care_details ?? {}
  const updatePet = (patch: Partial<PetCareDetails>) =>
    onChange('pet_care_details', { ...pet, ...patch })

  // Signing Date is the single source of truth; derive the month-name / year text
  // the drafting templates still consume so document output is unchanged.
  const handleSigningDateChange = (value: string) => {
    if (!value) {
      onChange('signing_date', null)
      onChange('signing_month', null)
      onChange('signing_year', null)
      return
    }
    onChange('signing_date', value)
    const d = new Date(`${value}T12:00:00`) // local noon avoids TZ off-by-one
    onChange('signing_month', d.toLocaleString('en-US', { month: 'long' }))
    onChange('signing_year', String(d.getFullYear()))
  }

  return (
    <div>
      <AttorneyNoteBanner>
        Select the documents for this matter first. The checked documents control which sections appear below and which drafts are generated.
      </AttorneyNoteBanner>

      <SectionBlock title="Plan Type">
        <PlanStructurePicker
          options={DESIGN_PLAN_TYPE_OPTIONS.map((opt) => ({
            value: opt.value,
            title: opt.label,
          }))}
          selected={normalizedPlanType}
          onSelect={(v) => onChange('plan_type', v)}
          heading="Plan structure"
        />
      </SectionBlock>

      {isLP && onPlanCoverageChange && (
        <SectionBlock title="Plan coverage" subtitle="Which documents this plan covers — drives the client design review's document list.">
          <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
            {(['no_trust', 'trust_included'] as const).map(c => (
              <button
                key={c}
                type="button"
                onClick={() => onPlanCoverageChange(c)}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
                  planCoverage === c
                    ? 'bg-card font-semibold text-primary shadow-sm'
                    : 'text-foreground hover:text-foreground'
                )}
              >
                {c === 'no_trust' ? 'No trust' : 'Trust included'}
              </button>
            ))}
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Documents Included">
        {needsDistributionMethod && (
          <ClientDecisionCallout>distribution method not yet selected</ClientDecisionCallout>
        )}
        <DocumentPicker
          inclusions={inclusions}
          onToggle={(key, checked) => updateDocument(key, checked)}
        />
        {isMarried && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox checked={inclusions.spouse_docs} onCheckedChange={value => updateDocument('spouse_docs', value === true)} />
              <span>
                <span className="block text-sm font-semibold text-foreground">Generate spouse / partner documents</span>
                <span className="block text-xs text-muted-foreground">Applies to Will, DPOA, and Health Care document packages when selected.</span>
              </span>
            </label>
          </div>
        )}
        {showDisclaimerToggle && (
          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-4">
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox
                checked={isDisclaimerTrust}
                onCheckedChange={value =>
                  onChange('decisions', setTrustPlanningType(sheet, value === true ? 'disclaimer' : 'standard'))
                }
              />
              <span>
                <span className="block text-sm font-semibold text-foreground">Use disclaimer trust structure</span>
                <span className="block text-xs text-muted-foreground">
                  Distributes outright to the surviving spouse, with a Marital (QTIP) / Family (bypass) split created if the
                  spouse disclaims. Replaces the standard individual revocable trust.
                </span>
              </span>
            </label>
          </div>
        )}
      </SectionBlock>

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

      <SectionBlock title="Pet Care">
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

      {/* Execution Mechanics — deferred, not required before drafting */}
      <div className="rounded-lg border border-dashed border-border bg-surface-1 p-6 mb-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-tertiary">Execution Mechanics</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Complete at the signing meeting — not required before drafting</span>
        </div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
          <div id="design-field-signing_date" tabIndex={-1}>
            <FieldLabel>Signing Date</FieldLabel>
            <Input
              type="date"
              value={sheet.signing_date ?? ''}
              onChange={e => handleSigningDateChange(e.target.value)}
              className="h-10"
            />
          </div>
          <AttorneyInput
            fieldName="signing_county"
            label="Signing County"
            value={sheet.signing_county ?? ''}
            placeholder="e.g. Middlesex"
            onChange={v => onChange('signing_county', v || null)}
          />
          <AttorneyInput
            fieldName="notary_commission_expiration"
            label="Notary Commission Expiration"
            value={sheet.notary_commission_expiration ?? ''}
            placeholder="MM/DD/YYYY"
            onChange={v => onChange('notary_commission_expiration', v || null)}
          />
        </div>
      </div>
    </div>
  )
}
