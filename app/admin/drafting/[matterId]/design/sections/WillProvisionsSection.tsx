'use client'

import { cn } from '@/lib/utils'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import { sheetHasMinorChildren } from '@/lib/designSheet/minorChildren'
import {
  AttorneyInput,
  AttorneyNoteBanner,
  AttorneySelect,
  ClientDecisionCallout,
  FieldLabel,
  SectionBlock,
  type SectionProps,
} from './shared'

function SegControl({ value, options, onChange }: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-lg bg-muted p-[2px]">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-md px-3 py-2 text-[12px] transition-all',
            value === o.value
              ? 'bg-card font-semibold text-primary shadow-sm'
              : 'text-foreground hover:text-foreground'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

type WillProvisionScope = 'all' | 'will' | 'dpoa' | 'healthcare'

export function WillProvisionsSection({ sheet, onChange, scope = 'all' }: SectionProps & { scope?: WillProvisionScope }) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  const isMarried = marital.includes('married') && !marital.includes('never')
  const hasMinors = sheetHasMinorChildren(sheet.children)
  const planType = normalizeDesignPlanType(sheet.plan_type)
  const isPourOver = planType === 'pour_over' || sheet.plan_type === 'pour_over'
  const isOutright = sheet.plan_type === 'outright_will'
  const isTestamentary = sheet.plan_type === 'testamentary_trust'
  // Default the toggle on when a reviewer was already captured (pre-toggle data).
  const includeSelfDealing = sheet.dpoa_include_self_dealing ?? Boolean(sheet.dpoa_self_dealing_reviewer)


  return (
    <div>
      <AttorneyNoteBanner>
        These selections drive language across the Will, DPOA, HCP, HIPAA, and Living Will templates.
        Defaults reflect Aubrey Law&apos;s typical recommendations — override per matter as needed.
      </AttorneyNoteBanner>

      {/* ── DPOA ────────────────────────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'dpoa') && (
      <SectionBlock title="Durable Power of Attorney — Additional Provisions">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {isMarried && (
            <div>
              <FieldLabel>Include Section L (Spousal Proximity / Support)</FieldLabel>
              <SegControl
                value={sheet.dpoa_include_section_l ?? 'no'}
                options={YES_NO}
                onChange={v => onChange('dpoa_include_section_l', v as 'yes' | 'no')}
              />
            </div>
          )}
        </div>
        <div className="mt-4 max-w-[320px]">
          <FieldLabel>Self-Dealing Reviewer (Section K)</FieldLabel>
          <SegControl
            value={includeSelfDealing ? 'yes' : 'no'}
            options={YES_NO}
            onChange={v => {
              const on = v === 'yes'
              onChange('dpoa_include_self_dealing', on)
              if (!on) {
                onChange('dpoa_self_dealing_reviewer', null)
                onChange('dpoa_self_dealing_reviewer_alt', null)
              }
            }}
          />
        </div>
        {includeSelfDealing && (
          <>
            <div className="mt-4">
              <ClientDecisionCallout>Self-dealing reviewer is required for HEMS-standard self-dealing under Section K. Easy to miss.</ClientDecisionCallout>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <AttorneyInput
                fieldName="dpoa_self_dealing_reviewer"
                label="Self-Dealing Reviewer (Section K)"
                value={sheet.dpoa_self_dealing_reviewer ?? ''}
                placeholder="Required for HEMS-standard self-dealing"
                onChange={v => onChange('dpoa_self_dealing_reviewer', v || null)}
              />
              <AttorneyInput
                fieldName="dpoa_self_dealing_reviewer_alt"
                label="Alternate Self-Dealing Reviewer"
                value={sheet.dpoa_self_dealing_reviewer_alt ?? ''}
                onChange={v => onChange('dpoa_self_dealing_reviewer_alt', v || null)}
              />
            </div>
          </>
        )}
      </SectionBlock>
      )}

      {/* ── HCP ─────────────────────────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'healthcare') && (
      <SectionBlock
        title="Health Care Proxy — Anatomical Gift"
        subtitle="Client must initial — no default"
      >
        <ClientDecisionCallout>Anatomical gift election. Client must initial — never default.</ClientDecisionCallout>
        <AttorneySelect
          fieldName="hcp_anatomical_gift"
          label="Anatomical Gift Election"
          value={sheet.hcp_anatomical_gift ?? ''}
          placeholder="Select…"
          options={[
            { value: 'all', label: 'Give any needed organs/tissues for any lawful purpose' },
            { value: 'specified', label: 'Give only specified organs/tissues for specified purposes' },
            { value: 'none', label: 'Make no anatomical gift' },
          ]}
          onChange={v => onChange('hcp_anatomical_gift', (v || null) as 'all' | 'specified' | 'none' | null)}
        />
        {sheet.hcp_anatomical_gift === 'specified' && (
          <div className="mt-4">
            <AttorneyInput
              fieldName="hcp_anatomical_specified"
              label="Specified organs / tissues / purposes"
              value={sheet.hcp_anatomical_specified ?? ''}
              placeholder="e.g. Cornea only, for transplant"
              onChange={v => onChange('hcp_anatomical_specified', v || null)}
            />
          </div>
        )}
      </SectionBlock>
      )}

      {/* ── HIPAA ───────────────────────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'healthcare') && (
      <SectionBlock
        title="HIPAA Authorization — Psychotherapy Notes"
        subtitle="Client must initial — no default"
      >
        <ClientDecisionCallout>Psychotherapy notes disclosure. Client must initial — never default.</ClientDecisionCallout>
        <AttorneySelect
          fieldName="hipaa_psychotherapy_notes"
          label="Psychotherapy Notes"
          value={sheet.hipaa_psychotherapy_notes ?? ''}
          placeholder="Select…"
          options={[
            { value: 'authorize', label: 'Authorize disclosure' },
            { value: 'do_not_authorize', label: 'Do NOT authorize disclosure' },
          ]}
          onChange={v => onChange('hipaa_psychotherapy_notes', (v || null) as 'authorize' | 'do_not_authorize' | null)}
        />
      </SectionBlock>
      )}

      {/* ── Will — Common Options ───────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'will') && (
      <SectionBlock title="Will — Common Provisions">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Bond</FieldLabel>
            <SegControl
              value={sheet.bond ?? 'no_bond'}
              options={[
                { value: 'no_bond', label: 'No bond (default)' },
                { value: 'required', label: 'Required' },
              ]}
              onChange={v => onChange('bond', v as 'no_bond' | 'required')}
            />
          </div>
          <div>
            <FieldLabel>Supervision</FieldLabel>
            <SegControl
              value={sheet.supervision ?? 'unsupervised'}
              options={[
                { value: 'unsupervised', label: 'Unsupervised (default)' },
                { value: 'supervised', label: 'Supervised' },
              ]}
              onChange={v => onChange('supervision', v as 'unsupervised' | 'supervised')}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
          <AttorneySelect
            label="Simultaneous Death"
            value={sheet.simultaneous_death ?? ''}
            placeholder={isMarried ? 'Default: spouse survives' : 'Default: omit'}
            options={[
              { value: 'spouse_survives', label: 'Spouse deemed to survive' },
              { value: 'testator_survives', label: 'Testator deemed to survive' },
              { value: 'omit', label: 'Omit' },
            ]}
            onChange={v => onChange('simultaneous_death', (v || null) as 'spouse_survives' | 'testator_survives' | 'omit' | null)}
          />
          <div>
            <FieldLabel>UTMA Age</FieldLabel>
            <SegControl
              value={String(sheet.utma_age ?? 21)}
              options={[
                { value: '18', label: '18' },
                { value: '21', label: '21 (default)' },
              ]}
              onChange={v => onChange('utma_age', (parseInt(v) as 18 | 21))}
            />
          </div>
          <div>
            <FieldLabel>No-Contest Clause</FieldLabel>
            <SegControl
              value={sheet.no_contest_clause ?? 'omit'}
              options={[
                { value: 'omit', label: 'Omit (default)' },
                { value: 'include', label: 'Include' },
              ]}
              onChange={v => onChange('no_contest_clause', v as 'omit' | 'include')}
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Disclaimer Article</FieldLabel>
            <SegControl
              value={sheet.include_disclaimer_article === false ? 'no' : 'yes'}
              options={[
                { value: 'yes', label: 'Include (default)' },
                { value: 'no', label: 'Omit' },
              ]}
              onChange={v => onChange('include_disclaimer_article', v === 'yes')}
            />
          </div>
          <div>
            <FieldLabel>Self-Proving Affidavit</FieldLabel>
            <SegControl
              value={sheet.include_self_proving_affidavit === false ? 'no' : 'yes'}
              options={[
                { value: 'yes', label: 'Include (default)' },
                { value: 'no', label: 'Omit' },
              ]}
              onChange={v => onChange('include_self_proving_affidavit', v === 'yes')}
            />
          </div>
        </div>
      </SectionBlock>
      )}


      {/* ── Pour-Over Specific ──────────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'will') && isPourOver && (
        <SectionBlock title="Pour-Over Will Specifics">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <AttorneyInput
              label="Trust Date"
              value={sheet.trust_date ?? ''}
              placeholder="MM/DD/YYYY"
              onChange={v => onChange('trust_date', v || null)}
            />
            <AttorneySelect
              label="Alternate Disposition (if pour-over fails)"
              value={sheet.pour_over_alternate_disposition ?? ''}
              placeholder="Select…"
              options={[
                { value: 'spouse_then_descendants', label: 'Spouse, then descendants' },
                { value: 'descendants_only', label: 'Descendants only' },
                { value: 'named', label: 'Named individual' },
              ]}
              onChange={v => onChange('pour_over_alternate_disposition', (v || null) as 'spouse_then_descendants' | 'descendants_only' | 'named' | null)}
            />
          </div>
          {sheet.pour_over_alternate_disposition === 'named' && (
            <div className="mt-4">
              <AttorneyInput
                label="Named Residuary Beneficiary"
                value={sheet.pour_over_alternate_named ?? ''}
                onChange={v => onChange('pour_over_alternate_named', v || null)}
              />
            </div>
          )}
        </SectionBlock>
      )}

      {/* ── Outright Will Specific ──────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'will') && isOutright && (
        <SectionBlock title="Outright Will — Residuary Estate">
          <AttorneySelect
            label="Residuary Distribution"
            value={sheet.outright_residuary ?? ''}
            placeholder="Select…"
            options={[
              { value: 'spouse_then_descendants', label: 'Spouse, then descendants' },
              { value: 'descendants_then_heirs', label: 'Descendants, then heirs at law' },
              { value: 'named', label: 'Named individual, then alternate, then heirs at law' },
            ]}
            onChange={v => onChange('outright_residuary', (v || null) as 'spouse_then_descendants' | 'descendants_then_heirs' | 'named' | null)}
          />
          {sheet.outright_residuary === 'named' && (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              <AttorneyInput
                label="Named Residuary Beneficiary"
                value={sheet.outright_residuary_named ?? ''}
                onChange={v => onChange('outright_residuary_named', v || null)}
              />
              <AttorneyInput
                label="Alternate Residuary Beneficiary"
                value={sheet.outright_residuary_alternate ?? ''}
                onChange={v => onChange('outright_residuary_alternate', v || null)}
              />
            </div>
          )}
        </SectionBlock>
      )}

      {/* ── Testamentary Trust Specific ─────────────────────────────────────── */}
      {(scope === 'all' || scope === 'will') && isTestamentary && (
        <SectionBlock title="Testamentary Trust Specifics" subtitle="Trustee structure is set in the Fiduciaries section">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <AttorneySelect
              label="Beneficiary Structure"
              value={sheet.beneficiary_structure ?? ''}
              placeholder="Select…"
              options={[
                { value: 'spouse_hems_then_descendants', label: 'Spouse for life (HEMS), remainder to descendants' },
                { value: 'descendants_per_stirpes', label: 'Descendants in separate shares per stirpes' },
                { value: 'single_beneficiary', label: 'Single beneficiary (HEMS)' },
              ]}
              onChange={v => onChange('beneficiary_structure', (v || null) as 'spouse_hems_then_descendants' | 'descendants_per_stirpes' | 'single_beneficiary' | null)}
            />
            {sheet.beneficiary_structure !== 'single_beneficiary' && (
              <AttorneySelect
                label="Age-Based Distribution Schedule"
                value={sheet.age_distribution_schedule ?? ''}
                placeholder="Select…"
                options={[
                  { value: 'outright_25', label: 'Outright at 25' },
                  { value: 'outright_30', label: 'Outright at 30' },
                  { value: 'outright_35', label: 'Outright at 35' },
                  { value: 'staggered_25_30_35', label: 'Staggered: 1/3 at 25, 1/2 of remainder at 30, balance at 35' },
                ]}
                onChange={v => onChange('age_distribution_schedule', (v || null) as 'outright_25' | 'outright_30' | 'outright_35' | 'staggered_25_30_35' | null)}
              />
            )}
          </div>
          {sheet.beneficiary_structure === 'single_beneficiary' && (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              <AttorneyInput
                label="Single Beneficiary Full Name"
                value={sheet.single_beneficiary_name ?? ''}
                onChange={v => onChange('single_beneficiary_name', v || null)}
              />
              <AttorneyInput
                label="Remainder Beneficiary or Description"
                value={sheet.single_beneficiary_remainder ?? ''}
                onChange={v => onChange('single_beneficiary_remainder', v || null)}
              />
            </div>
          )}
          {sheet.trust_protector && (
            <>
              <div className="mt-3">
                <ClientDecisionCallout>Trust protector affects governance flexibility — confirm with client.</ClientDecisionCallout>
              </div>
              <AttorneyInput
                label="Trust Protector Full Name"
                value={sheet.trust_protector_name ?? ''}
                onChange={v => onChange('trust_protector_name', v || null)}
              />
            </>
          )}
        </SectionBlock>
      )}
    </div>
  )
}
