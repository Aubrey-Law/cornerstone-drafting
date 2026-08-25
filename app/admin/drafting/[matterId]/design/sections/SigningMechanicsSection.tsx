'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { toDateInputValue } from '@/lib/dob'
import {
  getEstatePlanDesignSetup,
  setEstatePlanDesignSetup,
} from '@/lib/designSheetDocumentInclusions'
import {
  getExecutionMechanics,
  setExecutionMechanics,
  type DocumentAcknowledgment,
  type FinalDispositionExecution,
  type TrustAcknowledgment,
} from '@/lib/designSheet/executionMechanics'
import {
  AttorneyDateInput,
  AttorneyInput,
  AttorneySelect,
  DecisionRow,
  DesignSheetCheckboxOption,
  FieldLabel,
  SectionBlock,
  sectionFieldGrid2,
  sectionFieldGrid3,
  type SectionProps,
} from './shared'

const SIGNING_COUNTY_OPTIONS = [
  'Barnstable', 'Berkshire', 'Bristol', 'Dukes', 'Essex', 'Franklin',
  'Hampden', 'Hampshire', 'Middlesex', 'Nantucket', 'Norfolk', 'Plymouth',
  'Suffolk', 'Worcester',
]

/** Notary or witnesses — the two documents that take one or the other. */
const ACKNOWLEDGMENT_OPTIONS = [
  { value: 'notary' as const, label: 'Notary' },
  { value: 'witnesses' as const, label: 'Witnesses' },
]

export function SigningMechanicsSection({ sheet, onChange }: SectionProps) {
  const [open, setOpen] = useState(false)
  const setup = getEstatePlanDesignSetup(sheet)
  const execution = getExecutionMechanics(sheet)

  const updateSetup = (patch: Parameters<typeof setEstatePlanDesignSetup>[1]) => {
    onChange('decisions', previous => setEstatePlanDesignSetup(previous, patch))
  }

  const updateExecution = (patch: Parameters<typeof setExecutionMechanics>[1]) => {
    onChange('decisions', previous => setExecutionMechanics(previous, patch))
  }

  const handleSigningDateChange = (value: string) => {
    if (!value) {
      onChange('signing_date', null)
      onChange('signing_month', null)
      onChange('signing_year', null)
      return
    }
    onChange('signing_date', value)
    const date = new Date(`${value}T12:00:00`)
    onChange('signing_month', date.toLocaleString('en-US', { month: 'long' }))
    onChange('signing_year', String(date.getFullYear()))
  }

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-dashed border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
        aria-expanded={open}
        aria-controls="signing-mechanics-content"
        onClick={() => setOpen(current => !current)}
      >
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">Signing mechanics</span>
          <span className="block text-xs text-muted-foreground">Completed at the signing meeting</span>
        </span>
        <span className="rounded-full border border-border bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Deferred
        </span>
      </button>
      <div id="signing-mechanics-content" className={open ? 'border-t border-border p-5' : 'hidden'}>
        <div className={sectionFieldGrid3}>
          <div id="design-field-signing_type" tabIndex={-1}>
            <DecisionRow
              question="Signing type"
              help="Completed at the signing meeting; this never blocks drafting."
              value={setup.signing_type}
              options={[
                { value: 'undecided', label: 'Undecided' },
                { value: 'attorney_supervised', label: 'Attorney Supervised' },
                { value: 'independent_client', label: 'Independent Client' },
              ]}
              onChange={value => updateSetup({ signing_type: value })}
            />
          </div>
          <div id="design-field-signing_date" tabIndex={-1}>
            <FieldLabel>Signing Date</FieldLabel>
            <Input
              type="date"
              value={toDateInputValue(sheet.signing_date)}
              onChange={event => handleSigningDateChange(event.target.value)}
              className="h-10"
            />
          </div>
          <AttorneySelect
            fieldName="signing_county"
            label="Signing County"
            value={sheet.signing_county ?? ''}
            placeholder="Select..."
            options={SIGNING_COUNTY_OPTIONS.map(county => ({ value: county, label: county }))}
            onChange={value => onChange('signing_county', value || null)}
          />
          {/* City and notary name are `decisions.execution_mechanics` keys rather than
              columns like the three fields above; the split is storage-only, so they
              sit with the rest of the meeting details. */}
          <AttorneyInput
            fieldName="execution_mechanics.signing_city"
            label="Signing City or Town"
            value={execution.signing_city ?? ''}
            placeholder="Newton"
            onChange={value => updateExecution({ signing_city: value || null })}
          />
          <AttorneyDateInput
            fieldName="notary_commission_expiration"
            label="Notary Commission Expiration"
            value={sheet.notary_commission_expiration ?? ''}
            onChange={value => onChange('notary_commission_expiration', value || null)}
          />
          <AttorneyInput
            fieldName="execution_mechanics.notary_name"
            label="Notary Name"
            value={execution.notary_name ?? ''}
            placeholder="Full name as commissioned"
            onChange={value => updateExecution({ notary_name: value || null })}
          />
        </div>

        <div className="mt-6">
          <SectionBlock
            title="Acknowledgment Method"
            subtitle="How each document is executed. Answers print on the interview worksheet and drive the signature pages."
          >
            <DecisionRow
              question="Living trust"
              fieldName="execution_mechanics.trust_acknowledgment"
              value={execution.trust_acknowledgment ?? ''}
              options={[
                { value: 'notary', label: 'Notary' },
                { value: 'witnesses', label: 'Witnesses' },
                { value: 'both', label: 'Both', description: 'Witnessed and notarised.' },
              ]}
              onChange={value => updateExecution({
                trust_acknowledgment: (value || null) as TrustAcknowledgment | null,
              })}
            />
            <DecisionRow
              question="Power of attorney"
              fieldName="execution_mechanics.poa_acknowledgment"
              value={execution.poa_acknowledgment ?? ''}
              options={ACKNOWLEDGMENT_OPTIONS}
              onChange={value => updateExecution({
                poa_acknowledgment: (value || null) as DocumentAcknowledgment | null,
              })}
            />
            <DecisionRow
              question="Advance health care directive"
              fieldName="execution_mechanics.ahd_acknowledgment"
              value={execution.ahd_acknowledgment ?? ''}
              options={ACKNOWLEDGMENT_OPTIONS}
              onChange={value => updateExecution({
                ahd_acknowledgment: (value || null) as DocumentAcknowledgment | null,
              })}
            />
            <DecisionRow
              question="Health care authorization"
              fieldName="execution_mechanics.healthcare_authorization_acknowledgment"
              value={execution.healthcare_authorization_acknowledgment ?? ''}
              options={ACKNOWLEDGMENT_OPTIONS}
              onChange={value => updateExecution({
                healthcare_authorization_acknowledgment: (value || null) as DocumentAcknowledgment | null,
              })}
            />
            <DecisionRow
              question="Final disposition instructions"
              help="Two witnesses are required either way; the question is whether a notary also signs."
              fieldName="execution_mechanics.final_disposition_execution"
              value={execution.final_disposition_execution ?? ''}
              options={[
                { value: 'witnesses', label: 'Witnesses only' },
                { value: 'witnesses_and_notary', label: 'Witnesses and notary' },
              ]}
              onChange={value => updateExecution({
                final_disposition_execution: (value || null) as FinalDispositionExecution | null,
              })}
            />
          </SectionBlock>
        </div>

        <SectionBlock title="Signing Arrangements">
          <div className="space-y-3">
            <DesignSheetCheckboxOption
              label="Combine settlor and trustee signature lines"
              description="One signature block where the same person signs in both capacities, instead of two."
              checked={execution.combine_settlor_trustee_signatures}
              onChange={checked => updateExecution({ combine_settlor_trustee_signatures: checked })}
            />
            <DesignSheetCheckboxOption
              label="Health care documents signed in a nursing home"
              description="Adds the ombudsman or facility-witness language Massachusetts expects for a signing on the premises."
              checked={execution.healthcare_signed_in_nursing_home}
              onChange={checked => updateExecution({ healthcare_signed_in_nursing_home: checked })}
            />
          </div>
        </SectionBlock>

        <SectionBlock
          title="Witnesses"
          subtitle="Usually decided on the day. Fill these in only for a pre-arranged signing."
        >
          <div className="mb-4">
            <DesignSheetCheckboxOption
              label="Include witness phone numbers on the signature pages"
              checked={execution.include_witness_phones}
              onChange={checked => updateExecution({ include_witness_phones: checked })}
            />
          </div>
          <div className={sectionFieldGrid2}>
            <AttorneyInput
              fieldName="execution_mechanics.witness_1_address"
              label="Witness 1 Address"
              value={execution.witness_1_address ?? ''}
              onChange={value => updateExecution({ witness_1_address: value || null })}
            />
            <AttorneyInput
              fieldName="execution_mechanics.witness_1_phone"
              label="Witness 1 Phone"
              value={execution.witness_1_phone ?? ''}
              onChange={value => updateExecution({ witness_1_phone: value || null })}
            />
            <AttorneyInput
              fieldName="execution_mechanics.witness_2_address"
              label="Witness 2 Address"
              value={execution.witness_2_address ?? ''}
              onChange={value => updateExecution({ witness_2_address: value || null })}
            />
            <AttorneyInput
              fieldName="execution_mechanics.witness_2_phone"
              label="Witness 2 Phone"
              value={execution.witness_2_phone ?? ''}
              onChange={value => updateExecution({ witness_2_phone: value || null })}
            />
          </div>
        </SectionBlock>
      </div>
    </section>
  )
}
