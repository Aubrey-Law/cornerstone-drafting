'use client'

import { normalizeDesignPlanType } from '@/lib/designPlanType'
import { getDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import { getTrustDetails, setTrustDetails } from '@/lib/designSheetTrustDetails'
import {
  getDesignSheetWillProvisions,
  setDesignSheetWillProvisions,
} from '@/lib/designSheet/willProvisions'
import {
  AttorneyDateInput,
  AttorneyInput,
  AttorneyNoteBanner,
  ClientDecisionCallout,
  DecisionRow,
  SectionBlock,
  type SectionProps,
} from './shared'

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

type WillProvisionScope = 'all' | 'will' | 'dpoa' | 'healthcare'

export function WillProvisionsSection({ sheet, onChange, scope = 'all' }: SectionProps & { scope?: WillProvisionScope }) {
  const isMarried = sheet.matter_type === 'couple'
  const planType = normalizeDesignPlanType(sheet.plan_type)
  const isPourOver = planType === 'pour_over' || sheet.plan_type === 'pour_over'
  const isOutright = sheet.plan_type === 'outright_will'
  const isTestamentary = sheet.plan_type === 'testamentary_trust'
  // Default the toggle on when a reviewer was already captured (pre-toggle data).
  const includeSelfDealing = sheet.dpoa_include_self_dealing ?? Boolean(sheet.dpoa_self_dealing_reviewer)
  const spouseDocs = isMarried && getDocumentInclusions(sheet).spouse_docs
  const willProvisions = getDesignSheetWillProvisions(sheet)
  // The no-contest decision is stored twice: `no_contest_clause` (the column the
  // will template reads) and `trust_details.include_no_contest_clause` (which
  // toGeneratorData ORs over the column). Read the OR and write both, exactly as
  // the trust section's checkbox does — reading only the column showed "Omit"
  // on a will that drafted the clause anyway.
  const noContest = getTrustDetails(sheet).include_no_contest_clause || sheet.no_contest_clause === 'include'
  const updateWillProvisions = (
    patch: Parameters<typeof setDesignSheetWillProvisions>[1],
  ) => {
    onChange('decisions', previous => setDesignSheetWillProvisions(previous, patch))
  }


  return (
    <div>
      <AttorneyNoteBanner>
        These selections drive language across the Will, DPOA, HCP, HIPAA, and Living Will templates.
        Defaults reflect Aubrey Law&apos;s typical recommendations — override per matter as needed.
      </AttorneyNoteBanner>

      {/* ── DPOA ────────────────────────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'dpoa') && (
      <SectionBlock title="Durable Power of Attorney — Additional Provisions">
        {isMarried && (
          <DecisionRow
            question="Include Section L (Spousal Proximity / Support)"
            value={sheet.dpoa_include_section_l ?? 'no'}
            options={YES_NO}
            onChange={v => onChange('dpoa_include_section_l', v as 'yes' | 'no')}
          />
        )}
        <DecisionRow
            question="Self-Dealing Reviewer (Section K)"
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
        <DecisionRow
          fieldName="hcp_anatomical_gift"
          question="Anatomical gift election"
          blocking
          value={sheet.hcp_anatomical_gift}
          options={[
            { value: 'all', label: 'Give any needed organs/tissues for any lawful purpose' },
            { value: 'specified', label: 'Give only specified organs/tissues for specified purposes' },
            { value: 'none', label: 'Make no anatomical gift' },
          ]}
          onChange={v => onChange('hcp_anatomical_gift', v)}
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

      {/* ── Will — Common Options ───────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'will') && (
      <SectionBlock title="Will — Common Provisions">
        <DecisionRow question="Bond" value={sheet.bond ?? 'no_bond'} options={[
          { value: 'no_bond', label: 'No bond (default)' },
          { value: 'required', label: 'Required' },
        ]} onChange={v => onChange('bond', v)} />
        <DecisionRow question="Supervision" value={sheet.supervision ?? 'unsupervised'} options={[
          { value: 'unsupervised', label: 'Unsupervised (default)' },
          { value: 'supervised', label: 'Supervised' },
        ]} onChange={v => onChange('supervision', v)} />
        <DecisionRow question="Simultaneous death" help={isMarried ? 'Default: spouse survives.' : 'Default: omit.'} value={sheet.simultaneous_death} options={[
          { value: 'spouse_survives', label: 'Spouse deemed to survive' },
          { value: 'testator_survives', label: 'Testator deemed to survive' },
          { value: 'omit', label: 'Omit' },
        ]} onChange={v => onChange('simultaneous_death', v)} />
        <DecisionRow question="UTMA age" value={String(sheet.utma_age ?? 21)} options={[
          { value: '18', label: '18' },
          { value: '21', label: '21 (default)' },
        ]} onChange={v => onChange('utma_age', parseInt(v) as 18 | 21)} />
        <DecisionRow question="No-contest clause" help="Shared with the trust: this clause goes in both documents." value={noContest ? 'include' : 'omit'} options={[
          { value: 'omit', label: 'Omit (default)' },
          { value: 'include', label: 'Include' },
        ]} onChange={v => {
          onChange('decisions', previous => setTrustDetails(previous, { include_no_contest_clause: v === 'include' }))
          onChange('no_contest_clause', v)
        }} />
        <DecisionRow question="Disclaimer article" value={sheet.include_disclaimer_article === false ? 'no' : 'yes'} options={[
          { value: 'yes', label: 'Include (default)' },
          { value: 'no', label: 'Omit' },
        ]} onChange={v => onChange('include_disclaimer_article', v === 'yes')} />
        <DecisionRow question="Self-proving affidavit" value={sheet.include_self_proving_affidavit === false ? 'no' : 'yes'} options={[
          { value: 'yes', label: 'Include (default)' },
          { value: 'no', label: 'Omit' },
        ]} onChange={v => onChange('include_self_proving_affidavit', v === 'yes')} />
      </SectionBlock>
      )}

      {(scope === 'all' || scope === 'will') && (
      <SectionBlock
        title="Testamentary Power of Appointment"
        subtitle="Whether the will exercises a power of appointment held under someone else's instrument. Asked per settlor — one spouse may hold a power the other does not."
      >
        <DecisionRow
          question={spouseDocs ? 'Client exercises a power' : 'Exercise a power of appointment'}
          fieldName="will_provisions.exercise_testamentary_power_of_appointment"
          value={willProvisions.exercise_testamentary_power_of_appointment ? 'yes' : 'no'}
          options={YES_NO}
          onChange={v => updateWillProvisions({
            exercise_testamentary_power_of_appointment: v === 'yes',
          })}
        />
        {spouseDocs && (
          <DecisionRow
            question="Spouse exercises a power"
            fieldName="will_provisions.spouse_exercise_testamentary_power_of_appointment"
            value={willProvisions.spouse_exercise_testamentary_power_of_appointment ? 'yes' : 'no'}
            options={YES_NO}
            onChange={v => updateWillProvisions({
              spouse_exercise_testamentary_power_of_appointment: v === 'yes',
            })}
          />
        )}
      </SectionBlock>
      )}


      {/* ── Pour-Over Specific ──────────────────────────────────────────────── */}
      {(scope === 'all' || scope === 'will') && isPourOver && (
        <SectionBlock title="Pour-Over Will Specifics">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <AttorneyDateInput
              label="Trust Date"
              value={sheet.trust_date ?? ''}
              onChange={v => onChange('trust_date', v || null)}
            />
          </div>
          <DecisionRow question="Alternate disposition if pour-over fails" value={sheet.pour_over_alternate_disposition} options={[
            { value: 'spouse_then_descendants', label: 'Spouse, then descendants' },
            { value: 'descendants_only', label: 'Descendants only' },
            { value: 'named', label: 'Named individual' },
          ]} onChange={v => onChange('pour_over_alternate_disposition', v)} />
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
          <DecisionRow
            question="Residuary distribution"
            value={sheet.outright_residuary}
            options={[
              { value: 'spouse_then_descendants', label: 'Spouse, then descendants' },
              { value: 'descendants_then_heirs', label: 'Descendants, then heirs at law' },
              { value: 'named', label: 'Named individual, then alternate, then heirs at law' },
            ]}
            onChange={v => onChange('outright_residuary', v)}
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
          <DecisionRow question="Beneficiary structure" value={sheet.beneficiary_structure} options={[
            { value: 'spouse_hems_then_descendants', label: 'Spouse for life (HEMS), remainder to descendants' },
            { value: 'descendants_per_stirpes', label: 'Descendants in separate shares per stirpes' },
            { value: 'single_beneficiary', label: 'Single beneficiary (HEMS)' },
          ]} onChange={v => onChange('beneficiary_structure', v)} />
            {sheet.beneficiary_structure !== 'single_beneficiary' && (
              <DecisionRow
                question="Age-based distribution schedule"
                value={sheet.age_distribution_schedule}
                options={[
                  { value: 'outright_25', label: 'Outright at 25' },
                  { value: 'outright_30', label: 'Outright at 30' },
                  { value: 'outright_35', label: 'Outright at 35' },
                  { value: 'staggered_25_30_35', label: 'Staggered: 1/3 at 25, 1/2 of remainder at 30, balance at 35' },
                ]}
                onChange={v => onChange('age_distribution_schedule', v)}
              />
            )}
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
