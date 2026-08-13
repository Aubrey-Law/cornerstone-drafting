'use client'

import { useMemo, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { MatterContact } from '@/types/database'
import {
  getDocumentInclusions,
  getEstatePlanDesignSetup,
  setEstatePlanDesignSetup,
  type EstatePlanAncillaryDocumentKey,
  mergeDecisionUpdates,
  setDocumentInclusion,
} from '@/lib/designSheetDocumentInclusions'
import { resolveResidualBeneficiaryMethod } from '@/lib/designSheetTrustDetails'
import {
  getPersistedRealEstateTransfer,
  setSelectedAssetTransferDocs,
} from '@/lib/designSheetRealEstateTransfer'
import {
  DOCUMENT_TYPES,
  REAL_ESTATE_TRANSFER_DOC_TYPES,
  type RealEstateTransferDocType,
} from '@/lib/realEstateTransfer/fields'
import {
  DESIGN_PLAN_TYPE_OPTIONS,
  designPlanTypeIncludesRevocableTrust,
  normalizeDesignPlanType,
  planTypeDisallowsRevocableTrustDocument,
  type DesignPlanType,
} from '@/lib/designPlanType'
import {
  AttorneyNoteBanner,
  ClientDecisionCallout,
  DecisionRow,
  DesignSectionContent,
  SectionBlock,
  sectionFieldGrid2,
  type SectionProps,
} from './shared'
import { PlanStructureFactsSection } from './PlanStructureFactsSection'
import { PlanTrackNotice } from './PlanTrackNotice'

interface PlanDesignSectionProps extends SectionProps {
  matterId: string
  practiceArea: string | null
  contacts?: MatterContact[]
  onAddContact?: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  onUpdateContact?: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  showInapplicable?: boolean
}

const FUNDING_DOCUMENT_LABELS: Record<
  'certificate_of_trust' | 'assignment_of_personal_property' | 'funding_instructions' | 'funding_recommendation' | 'homestead_trustee',
  string
> = {
  certificate_of_trust: 'Certificate of Trust',
  assignment_of_personal_property: 'Assignment of Personal Property',
  funding_instructions: 'Funding Instructions',
  funding_recommendation: 'Funding Recommendation',
  homestead_trustee: 'Declaration of Homestead (Trustee)',
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

function ApplicableDecision({
  applicable,
  showInapplicable,
  children,
}: {
  applicable: boolean
  showInapplicable: boolean
  children: ReactNode
}) {
  if (!applicable && !showInapplicable) return null
  return <div className={!applicable ? 'opacity-45 grayscale-[20%]' : undefined}>{children}</div>
}

export function PlanDesignSection({
  sheet,
  onChange,
  matterId,
  practiceArea,
  contacts: _contacts = [],
  onAddContact: _onAddContact,
  onUpdateContact: _onUpdateContact,
  showInapplicable = false,
}: PlanDesignSectionProps) {
  const normalizedPlanType = normalizeDesignPlanType(sheet.plan_type)
  const inclusions = getDocumentInclusions(sheet)
  const estatePlanSetup = getEstatePlanDesignSetup(sheet)
  const needsDistributionMethod = resolveResidualBeneficiaryMethod(sheet) == null
  const isMarried = sheet.matter_type === 'couple'
  const fundingDocKeys: FundingDocumentKey[] = [
    'certificate_of_trust',
    'assignment_of_personal_property',
    'funding_instructions',
    'funding_recommendation',
    'homestead_trustee',
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

  const updateDecisions = (
    ...updates: Array<(current: Pick<typeof sheet, 'decisions'>) => Record<string, unknown>>
  ) => {
    onChange('decisions', prevSheet => mergeDecisionUpdates(prevSheet, ...updates))
  }

  const updateDocument = (key: keyof typeof inclusions, checked: boolean) => {
    updateDecisions(current => setDocumentInclusion(current, key, checked))
  }

  const updateEstatePlanSetup = (patch: Parameters<typeof setEstatePlanDesignSetup>[1]) => {
    updateDecisions(current => setEstatePlanDesignSetup(current, patch))
  }

  const handlePlanTypeSelect = (value: string) => {
    const nextPlanType = value as DesignPlanType
    onChange('plan_type', () => nextPlanType)

    if (planTypeDisallowsRevocableTrustDocument(nextPlanType)) {
      onChange('decisions', prevSheet => {
        const inclusionsForPlan = getDocumentInclusions({ ...prevSheet, plan_type: value })
        if (!inclusionsForPlan.trust) return prevSheet.decisions ?? {}
        return mergeDecisionUpdates(prevSheet,
          current => setDocumentInclusion(current, 'trust', false),
          current => setEstatePlanDesignSetup(current, { trust: false, will_title: 'last_will' }),
        )
      })
      return
    }

    if (designPlanTypeIncludesRevocableTrust(nextPlanType)) {
      onChange('decisions', prevSheet => {
        const inclusionsForPlan = getDocumentInclusions({ ...prevSheet, plan_type: value })
        if (inclusionsForPlan.trust) return prevSheet.decisions ?? {}
        return mergeDecisionUpdates(prevSheet,
          current => setDocumentInclusion(current, 'trust', true),
          current => setEstatePlanDesignSetup(current, { trust: true, will_title: 'pour_over_will' }),
        )
      })
    }
  }

  const updateCoreDocument = (
    key: 'trust' | 'will' | 'power_of_attorney' | 'health_care_proxy' | 'hipaa_authorization' | 'living_will',
    checked: boolean,
  ) => {
    if (key === 'trust') {
      if (planTypeDisallowsRevocableTrustDocument(normalizedPlanType)) return
      updateDecisions(
        current => setDocumentInclusion(current, 'trust', checked),
        current => setEstatePlanDesignSetup(current, {
          trust: checked,
          will_title: checked ? 'pour_over_will' : 'last_will',
        }),
      )
      return
    }
    if (key === 'will') {
      updateDecisions(
        current => setDocumentInclusion(current, 'will', checked),
        current => setEstatePlanDesignSetup(current, { will: checked }),
      )
      return
    }
    if (key === 'power_of_attorney') {
      updateDecisions(
        current => setDocumentInclusion(current, 'dpoa', checked),
        current => setEstatePlanDesignSetup(current, { power_of_attorney: checked }),
      )
      return
    }

    const nextHealthcare = {
      health_care_proxy: key === 'health_care_proxy' ? checked : estatePlanSetup.health_care_proxy,
      hipaa_authorization: key === 'hipaa_authorization' ? checked : estatePlanSetup.hipaa_authorization,
      living_will: key === 'living_will' ? checked : estatePlanSetup.living_will,
    }
    updateDecisions(
      current => setDocumentInclusion(current, 'healthcare', Object.values(nextHealthcare).some(Boolean)),
      current => setEstatePlanDesignSetup(current, {
        health_care_proxy: nextHealthcare.health_care_proxy,
        hipaa_authorization: nextHealthcare.hipaa_authorization,
        living_will: nextHealthcare.living_will,
      }),
    )
  }

  const updateAncillaryDocument = (key: EstatePlanAncillaryDocumentKey, checked: boolean) => {
    updateEstatePlanSetup({
      ancillary_documents: {
        ...estatePlanSetup.ancillary_documents,
        [key]: checked,
      },
    })
  }

  const selectedAssetTransferDocs = useMemo(
    () => new Set(getPersistedRealEstateTransfer(sheet).selectedDocs),
    [sheet],
  )

  const updateAssetTransferDoc = (docType: RealEstateTransferDocType, checked: boolean) => {
    const next = new Set(selectedAssetTransferDocs)
    if (checked) next.add(docType)
    else next.delete(docType)
    onChange('decisions', prevSheet => setSelectedAssetTransferDocs(prevSheet, Array.from(next)))
  }

  const trustCheckboxDisabled = planTypeDisallowsRevocableTrustDocument(normalizedPlanType)
  const revocableTrustDecisionApplies = normalizedPlanType == null
    || designPlanTypeIncludesRevocableTrust(normalizedPlanType)

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Select the documents for this matter first. The checked documents control which sections appear below and which drafts are generated.
      </AttorneyNoteBanner>

      <PlanTrackNotice matterId={matterId} practiceArea={practiceArea} />

      <SectionBlock title="Plan Type">
        <DecisionRow
          question="Plan type"
          help="Choose the structure that controls the document package and downstream drafting choices."
          fieldName="plan_type"
          blocking
          options={DESIGN_PLAN_TYPE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
          }))}
          value={normalizedPlanType}
          onChange={handlePlanTypeSelect}
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
                const applicable = !isTrust || revocableTrustDecisionApplies
                const disabled = isTrust && trustCheckboxDisabled
                return (
                <ApplicableDecision key={item.key} applicable={applicable} showInapplicable={showInapplicable}>
                <label
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
                </ApplicableDecision>
                )
              })}
            </div>
          </div>

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
              <ApplicableDecision
                applicable={revocableTrustDecisionApplies}
                showInapplicable={showInapplicable}
              >
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
              </ApplicableDecision>

              <div className={sectionFieldGrid2}>
                {standaloneAncillaryKeys.map(key => {
                  const trustOnly = key === 'trust_summary' || key === 'successor_trustee_checklist'
                  return (
                  <ApplicableDecision
                    key={key}
                    applicable={!trustOnly || revocableTrustDecisionApplies}
                    showInapplicable={showInapplicable}
                  >
                  <label key={key} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
                    <Checkbox
                      checked={estatePlanSetup.ancillary_documents[key]}
                      onCheckedChange={value => updateAncillaryDocument(key, value === true)}
                    />
                    <span className="text-sm text-foreground">{ANCILLARY_DOCUMENT_LABELS[key]}</span>
                  </label>
                  </ApplicableDecision>
                  )
                })}
              </div>
            </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Asset Transfer Documents</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Selected documents are generated with the estate plan. Transfers &amp; Assignments only shows fields needed for the checked documents.
            </p>
            <div className="space-y-3">
              {REAL_ESTATE_TRANSFER_DOC_TYPES.map(docType => (
                <label
                  key={docType}
                  className="flex items-start gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5"
                >
                  <Checkbox
                    checked={selectedAssetTransferDocs.has(docType)}
                    onCheckedChange={value => updateAssetTransferDoc(docType, value === true)}
                  />
                  <span className="text-sm text-foreground">{DOCUMENT_TYPES[docType].label}</span>
                </label>
              ))}
            </div>
          </div>

          <PlanStructureFactsSection sheet={sheet} onChange={onChange} />
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}
