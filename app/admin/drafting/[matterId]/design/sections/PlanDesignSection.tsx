'use client'

import { PlanStructurePicker } from '@/components/guided/PlanStructurePicker'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { MatterContact } from '@/types/database'
import {
  getDocumentInclusions,
  getEstatePlanDesignSetup,
  setEstatePlanDesignSetup,
  type EstatePlanAncillaryDocumentKey,
  setDocumentInclusion,
} from '@/lib/designSheetDocumentInclusions'
import {
  DESIGN_PLAN_TYPE_OPTIONS,
  designPlanTypeIncludesRevocableTrust,
  normalizeDesignPlanType,
  planTypeDisallowsRevocableTrustDocument,
  type DesignPlanType,
} from '@/lib/designPlanType'
import { Input } from '@/components/ui/input'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  AttorneySelect,
  ClientDecisionCallout,
  DesignSectionContent,
  FieldLabel,
  SectionBlock,
  sectionFieldGrid2,
  sectionFieldGrid3,
  type SectionProps,
} from './shared'

interface PlanDesignSectionProps extends SectionProps {
  contacts?: MatterContact[]
  onAddContact?: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
}

const SIGNING_COUNTY_OPTIONS = [
  'Barnstable',
  'Berkshire',
  'Bristol',
  'Dukes',
  'Essex',
  'Franklin',
  'Hampden',
  'Hampshire',
  'Middlesex',
  'Nantucket',
  'Norfolk',
  'Plymouth',
  'Suffolk',
  'Worcester',
]

const FUNDING_DOCUMENT_LABELS: Record<
  'certificate_of_trust' | 'assignment_of_personal_property' | 'funding_instructions' | 'funding_recommendation',
  string
> = {
  certificate_of_trust: 'Certificate of Trust',
  assignment_of_personal_property: 'Assignment of Personal Property',
  funding_instructions: 'Funding Instructions',
  funding_recommendation: 'Funding Recommendation',
}

const ANCILLARY_DOCUMENT_LABELS: Record<
  'trust_summary' | 'estate_plan_summary' | 'estate_plan_signing_guide' | 'successor_trustee_checklist' | 'fiduciary_role_guide' | 'flowchart' | 'include_asset_spreadsheet',
  string
> = {
  trust_summary: 'Trust Summary',
  estate_plan_summary: 'Estate Plan Summary',
  estate_plan_signing_guide: 'Estate Plan Signing Guide',
  successor_trustee_checklist: 'Successor Trustee Checklist',
  fiduciary_role_guide: 'Fiduciary Role Guide',
  flowchart: 'Flowchart',
  include_asset_spreadsheet: 'Include Asset Spreadsheet',
}

type FundingDocumentKey = keyof typeof FUNDING_DOCUMENT_LABELS
type StandaloneAncillaryDocumentKey = keyof typeof ANCILLARY_DOCUMENT_LABELS

export function PlanDesignSection({ sheet, onChange, contacts: _contacts = [], onAddContact: _onAddContact, onUpdateContact: _onUpdateContact }: PlanDesignSectionProps) {
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const inclusions = getDocumentInclusions(sheet)
  const estatePlanSetup = getEstatePlanDesignSetup(sheet)
  const needsDistributionMethod = !sheet.distribution_method
  const isMarried = (sheet.marital_status ?? '').toLowerCase().includes('married')
  const fundingDocKeys: FundingDocumentKey[] = [
    'certificate_of_trust',
    'assignment_of_personal_property',
    'funding_instructions',
    'funding_recommendation',
  ]
  const standaloneAncillaryKeys: StandaloneAncillaryDocumentKey[] = [
    'trust_summary',
    'estate_plan_summary',
    'estate_plan_signing_guide',
    'successor_trustee_checklist',
    'fiduciary_role_guide',
    'flowchart',
    'include_asset_spreadsheet',
  ]

  const updateDocument = (key: keyof typeof inclusions, checked: boolean) => {
    onChange('decisions', setDocumentInclusion(sheet, key, checked))
  }

  const updateEstatePlanSetup = (patch: Parameters<typeof setEstatePlanDesignSetup>[1]) => {
    onChange('decisions', setEstatePlanDesignSetup(sheet, patch))
  }

  const handlePlanTypeSelect = (value: string) => {
    const nextPlanType = value as DesignPlanType
    onChange('plan_type', value)

    if (planTypeDisallowsRevocableTrustDocument(nextPlanType)) {
      if (inclusions.trust) {
        updateDocument('trust', false)
        updateEstatePlanSetup({ trust: false, will_title: 'last_will' })
      }
      return
    }

    if (designPlanTypeIncludesRevocableTrust(nextPlanType) && !inclusions.trust) {
      updateDocument('trust', true)
      updateEstatePlanSetup({ trust: true, will_title: 'pour_over_will' })
    }
  }

  const updateCoreDocument = (
    key: 'trust' | 'will' | 'power_of_attorney' | 'health_care_proxy' | 'hipaa_authorization' | 'living_will',
    checked: boolean,
  ) => {
    if (key === 'trust') {
      if (planTypeDisallowsRevocableTrustDocument(normalizedPlanType)) return
      updateDocument('trust', checked)
      updateEstatePlanSetup({
        trust: checked,
        will_title: checked ? 'pour_over_will' : 'last_will',
      })
      return
    }
    if (key === 'will') {
      updateDocument('will', checked)
      updateEstatePlanSetup({ will: checked })
      return
    }
    if (key === 'power_of_attorney') {
      updateDocument('dpoa', checked)
      updateEstatePlanSetup({ power_of_attorney: checked })
      return
    }

    const nextHealthcare = {
      health_care_proxy: key === 'health_care_proxy' ? checked : estatePlanSetup.health_care_proxy,
      hipaa_authorization: key === 'hipaa_authorization' ? checked : estatePlanSetup.hipaa_authorization,
      living_will: key === 'living_will' ? checked : estatePlanSetup.living_will,
    }
    updateDocument('healthcare', Object.values(nextHealthcare).some(Boolean))
    updateEstatePlanSetup({
      health_care_proxy: nextHealthcare.health_care_proxy,
      hipaa_authorization: nextHealthcare.hipaa_authorization,
      living_will: nextHealthcare.living_will,
    })
  }

  const updateAncillaryDocument = (key: EstatePlanAncillaryDocumentKey, checked: boolean) => {
    updateEstatePlanSetup({
      ancillary_documents: {
        ...estatePlanSetup.ancillary_documents,
        [key]: checked,
      },
    })
  }

  const clientFirst = (sheet.client_name ?? '').trim().split(/\s+/)[0] || ''
  const trustCheckboxDisabled = planTypeDisallowsRevocableTrustDocument(normalizedPlanType)

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
    <DesignSectionContent>
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
          onSelect={handlePlanTypeSelect}
          heading="Plan structure"
        />
      </SectionBlock>

      <SectionBlock title="Documents Included">
        {needsDistributionMethod && (
          <ClientDecisionCallout>distribution method not yet selected</ClientDecisionCallout>
        )}
        <div className="space-y-5 pt-1">
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Core Documents</p>
            <div className="space-y-3">
              {[
                { key: 'trust', label: 'Trust' },
                { key: 'will', label: 'Will' },
                { key: 'power_of_attorney', label: 'Power of Attorney' },
                { key: 'health_care_proxy', label: 'Health Care Proxy' },
                { key: 'hipaa_authorization', label: 'HIPAA Authorization' },
                { key: 'living_will', label: 'Living Will' },
              ].map(item => {
                const isTrust = item.key === 'trust'
                const disabled = isTrust && trustCheckboxDisabled
                return (
                <label
                  key={item.key}
                  className={cn(
                    'flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Checkbox
                    checked={!disabled && estatePlanSetup[item.key as keyof typeof estatePlanSetup] === true}
                    disabled={disabled}
                    onCheckedChange={value => {
                      if (disabled) return
                      updateCoreDocument(item.key as Parameters<typeof updateCoreDocument>[0], value === true)
                    }}
                  />
                  <span className="text-sm text-foreground">
                    {item.label}
                    {disabled && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Not available with Will — Testamentary Trust. The testamentary trust is created under the will, not as a separate revocable trust document.
                      </span>
                    )}
                  </span>
                </label>
                )
              })}
            </div>
          </div>

          {estatePlanSetup.will && (
            <div className="rounded-md border border-border bg-muted/20 p-4">
              <ClientDecisionCallout>review the will title before drafting</ClientDecisionCallout>
              <div className={sectionFieldGrid2}>
                <AttorneySelect
                  label="Will Title"
                  value={estatePlanSetup.will_title}
                  options={[
                    { value: 'last_will', label: `Last Will and Testament of ${clientFirst || '[Name]'}` },
                    { value: 'pour_over_will', label: `Pour-Over Will of ${clientFirst || '[Name]'}` },
                  ]}
                  onChange={value => updateEstatePlanSetup({ will_title: value as 'last_will' | 'pour_over_will' })}
                />
              </div>
            </div>
          )}

          {isMarried && (
            <div className="rounded-lg border border-border bg-muted/50 p-4">
              <label className="flex cursor-pointer items-center gap-3">
                <Checkbox checked={inclusions.spouse_docs} onCheckedChange={value => updateDocument('spouse_docs', value === true)} />
                <span>
                  <span className="block text-sm font-semibold text-foreground">Generate spouse / partner documents</span>
                  <span className="block text-xs text-muted-foreground">Applies to Will, DPOA, and Health Care document packages when selected.</span>
                </span>
              </label>
            </div>
          )}

          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Ancillary Documents</p>
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/20 p-4">
                <p className="mb-3 text-sm font-semibold text-foreground">Funding Documents</p>
                <div className="space-y-2">
                  {fundingDocKeys.map(key => (
                    <label key={key} className="flex items-start gap-3">
                      <Checkbox
                        checked={estatePlanSetup.ancillary_documents[key]}
                        onCheckedChange={value => updateAncillaryDocument(key, value === true)}
                      />
                      <span className="text-sm text-foreground">{FUNDING_DOCUMENT_LABELS[key]}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={sectionFieldGrid2}>
                {standaloneAncillaryKeys.map(key => (
                  <label key={key} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
                    <Checkbox
                      checked={estatePlanSetup.ancillary_documents[key]}
                      onCheckedChange={value => updateAncillaryDocument(key, value === true)}
                    />
                    <span className="text-sm text-foreground">{ANCILLARY_DOCUMENT_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SectionBlock>

      {/* Execution Mechanics — deferred, not required before drafting */}
      <div className="rounded-lg border border-dashed border-border bg-surface-1 p-6 mb-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-text-tertiary">Execution Mechanics</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Complete at the signing meeting — not required before drafting</span>
        </div>
        <div className={sectionFieldGrid3}>
          <AttorneySelect
            label="Signing Type"
            value={estatePlanSetup.signing_type}
            options={[
              { value: 'undecided', label: 'Undecided' },
              { value: 'attorney_supervised', label: 'Attorney Supervised' },
              { value: 'independent_client', label: 'Independent Client' },
            ]}
            onChange={value => updateEstatePlanSetup({ signing_type: value as 'undecided' | 'attorney_supervised' | 'independent_client' })}
          />
          <div id="design-field-signing_date" tabIndex={-1}>
            <FieldLabel>Signing Date</FieldLabel>
            <Input
              type="date"
              value={sheet.signing_date ?? ''}
              onChange={e => handleSigningDateChange(e.target.value)}
              className="h-10"
            />
          </div>
          <AttorneySelect
            fieldName="signing_county"
            label="Signing County"
            value={sheet.signing_county ?? ''}
            placeholder="Select..."
            options={SIGNING_COUNTY_OPTIONS.map(county => ({ value: county, label: county }))}
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
    </DesignSectionContent>
  )
}
