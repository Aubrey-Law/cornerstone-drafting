'use client'

import {
  AttorneyInput,
  AttorneyNoteBanner,
  DobAgeHint,
  PRONOUN_OPTIONS,
  PrefilledInput,
  PrefilledSelect,
  SectionBlock,
  type SectionProps,
} from './shared'

export function ClientInformationSection({ sheet, onChange }: SectionProps) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  const isMarried = marital.includes('married') && !marital.includes('never')
  const isDivorced = marital.includes('divorced')
  const isWidowed = marital.includes('widow')
  const original = (field: string) => sheet.overrides?.[field]?.original

  return (
    <div>
      <AttorneyNoteBanner>
        Fields with a gray background were pre-filled from the client intake questionnaire.
        You can override any value — overridden fields will be highlighted in amber.
        Blank white fields are attorney-only and were not part of the intake.
      </AttorneyNoteBanner>

      <SectionBlock title="Client" subtitle="Primary grantor">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <PrefilledInput fieldName="client_name" label="Full Legal Name" value={sheet.client_name ?? ''} originalValue={original('client_name')} onChange={v => onChange('client_name', v)} />
          <AttorneyInput
            label="Also Known As (AKA)"
            value={sheet.client_aka ?? ''}
            placeholder="Other names used (used in Wills)"
            onChange={v => onChange('client_aka', v || null)}
          />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <PrefilledSelect
            fieldName="client_pronouns"
            label="Pronouns"
            value={sheet.client_pronouns ?? ''}
            originalValue={original('client_pronouns')}
            options={PRONOUN_OPTIONS}
            onChange={v => onChange('client_pronouns', v || null)}
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <PrefilledInput fieldName="client_dob" label="Date of Birth" value={sheet.client_dob ?? ''} originalValue={original('client_dob')} onChange={v => onChange('client_dob', v)} />
            <DobAgeHint dob={sheet.client_dob} />
          </div>
          <PrefilledInput label="Phone" type="tel" value={sheet.client_phone ?? ''} originalValue={original('client_phone')} onChange={v => onChange('client_phone', v)} />
          <PrefilledInput fieldName="client_email" label="Email" value={sheet.client_email ?? ''} originalValue={original('client_email')} onChange={v => onChange('client_email', v)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <PrefilledInput
            fieldName="marital_status"
            label="Marital Status"
            value={sheet.marital_status ?? ''}
            originalValue={original('marital_status')}
            onChange={v => onChange('marital_status', v)}
          />
        </div>

        {/* Former / Deceased spouse, conditional on marital status */}
        {(isDivorced || isWidowed) && (
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            {isDivorced && (
              <AttorneyInput
                label="Former Spouse Name"
                value={sheet.former_spouse_name ?? ''}
                onChange={v => onChange('former_spouse_name', v || null)}
              />
            )}
            {isWidowed && (
              <AttorneyInput
                label="Deceased Spouse Name"
                value={sheet.deceased_spouse_name ?? ''}
                onChange={v => onChange('deceased_spouse_name', v || null)}
              />
            )}
          </div>
        )}

        <div className="mt-4 grid grid-cols-4 gap-x-4 gap-y-4">
          <PrefilledInput label="Street Address" value={sheet.street ?? ''} originalValue={original('street')} onChange={v => onChange('street', v)} />
          <PrefilledInput label="City" value={sheet.city ?? ''} originalValue={original('city')} onChange={v => onChange('city', v)} />
          <PrefilledInput fieldName="state" label="State" value={sheet.state ?? ''} originalValue={original('state')} onChange={v => onChange('state', v)} />
          <PrefilledInput label="ZIP" value={sheet.zip ?? ''} originalValue={original('zip')} onChange={v => onChange('zip', v)} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <PrefilledInput label="County" value={sheet.county ?? ''} originalValue={original('county')} onChange={v => onChange('county', v)} />
        </div>
      </SectionBlock>

      {isMarried && (
        <SectionBlock title="Spouse / Partner" subtitle="Co-grantor">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            <PrefilledInput fieldName="spouse_name" label="Full Legal Name" value={sheet.spouse_name ?? ''} originalValue={original('spouse_name')} onChange={v => onChange('spouse_name', v)} />
            <AttorneyInput
              label="Also Known As (AKA)"
              value={sheet.spouse_aka ?? ''}
              placeholder="Other names used (used in Wills)"
              onChange={v => onChange('spouse_aka', v || null)}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <PrefilledInput label="Date of Birth" value={sheet.spouse_dob ?? ''} originalValue={original('spouse_dob')} onChange={v => onChange('spouse_dob', v)} />
              <DobAgeHint dob={sheet.spouse_dob} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <PrefilledInput label="Phone" type="tel" value={sheet.spouse_phone ?? ''} originalValue={original('spouse_phone')} onChange={v => onChange('spouse_phone', v)} />
            <PrefilledInput label="Email" value={sheet.spouse_email ?? ''} originalValue={original('spouse_email')} onChange={v => onChange('spouse_email', v)} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <PrefilledSelect
              fieldName="spouse_pronouns"
              label="Pronouns"
              value={sheet.spouse_pronouns ?? ''}
              originalValue={original('spouse_pronouns')}
              options={PRONOUN_OPTIONS}
              onChange={v => onChange('spouse_pronouns', v || null)}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <PrefilledSelect
              label="Citizenship"
              value={sheet.spouse_citizenship || 'US Citizen'}
              originalValue={original('spouse_citizenship')}
              options={[
                { value: 'US Citizen', label: 'US Citizen' },
                { value: 'Permanent Resident', label: 'Permanent Resident' },
                { value: 'Non-Resident Alien', label: 'Non-Resident Alien' },
              ]}
              onChange={v => onChange('spouse_citizenship', v)}
            />
            <PrefilledInput label="Date of Marriage" value={sheet.marriage_date ?? ''} originalValue={original('marriage_date')} onChange={v => onChange('marriage_date', v)} />
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Citizenship & Residency">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <PrefilledSelect
            label="Citizenship"
            value={sheet.client_citizenship || 'US Citizen'}
            originalValue={original('client_citizenship')}
            options={[
              { value: 'US Citizen', label: 'US Citizen' },
              { value: 'Permanent Resident', label: 'Permanent Resident' },
              { value: 'Non-Resident Alien', label: 'Non-Resident Alien' },
            ]}
            onChange={v => onChange('client_citizenship', v)}
          />
          <PrefilledInput label="State of Domicile" value={sheet.client_domicile || sheet.state || ''} originalValue={original('client_domicile')} onChange={v => onChange('client_domicile', v)} />
        </div>
      </SectionBlock>
    </div>
  )
}

/** @deprecated Use ClientInformationSection */
export const PersonalSection = ClientInformationSection
