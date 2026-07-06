'use client'

import {
  AttorneyInput,
  AttorneyNoteBanner,
  DesignSectionContent,
  DobAgeHint,
  SectionBlock,
  sectionFieldGrid2,
  sectionFieldGrid3,
  sectionFieldGrid4,
  type SectionProps,
} from './shared'
import { DesignField } from '@/components/sharedFields/DesignField'
import { normalizeCitizenship } from '@/lib/sharedFields'

export function ClientInformationSection({ sheet, onChange }: SectionProps) {
  const marital = (sheet.marital_status ?? '').toLowerCase()
  const isMarried = marital.includes('married') && !marital.includes('never')
  const isDivorced = marital.includes('divorced')
  const isWidowed = marital.includes('widow')
  const original = (field: string) => sheet.overrides?.[field]?.original

  const citizenshipDisplay =
    normalizeCitizenship(sheet.client_citizenship) ?? 'US Citizen'
  const spouseCitizenshipDisplay =
    normalizeCitizenship(sheet.spouse_citizenship) ?? 'US Citizen'

  return (
    <DesignSectionContent>
      <AttorneyNoteBanner>
        Fields with a gray background were pre-filled from the client intake questionnaire.
        You can override any value — overridden fields will be highlighted in amber.
        Blank white fields are attorney-only and were not part of the intake.
      </AttorneyNoteBanner>

      <SectionBlock title="Client" subtitle="Primary grantor">
        <div className={sectionFieldGrid2}>
          <DesignField
            fieldId="client_name"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_name')}
          />
          <AttorneyInput
            label="Also Known As (AKA)"
            value={sheet.client_aka ?? ''}
            placeholder="Other names used (used in Wills)"
            onChange={v => onChange('client_aka', v || null)}
          />
        </div>
        <div className={`mt-4 ${sectionFieldGrid2}`}>
          <DesignField
            fieldId="client_pronouns"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_pronouns')}
          />
          <DesignField
            fieldId="marital_status"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('marital_status')}
          />
        </div>
        <div className={`mt-4 ${sectionFieldGrid3}`}>
          <DesignField
            fieldId="client_dob"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_dob')}
            footer={<DobAgeHint dob={sheet.client_dob} />}
          />
          <DesignField
            fieldId="client_phone"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_phone')}
          />
          <DesignField
            fieldId="client_email"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_email')}
          />
        </div>

        {(isDivorced || isWidowed) && (
          <div className={`mt-4 ${sectionFieldGrid2}`}>
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

        <div className={`mt-4 ${sectionFieldGrid4}`}>
          <DesignField fieldId="street" sheet={sheet} onChange={onChange} originalValue={original('street')} />
          <DesignField fieldId="city" sheet={sheet} onChange={onChange} originalValue={original('city')} />
          <DesignField fieldId="state" sheet={sheet} onChange={onChange} originalValue={original('state')} />
          <DesignField fieldId="zip" sheet={sheet} onChange={onChange} originalValue={original('zip')} />
        </div>
        <div className={`mt-4 ${sectionFieldGrid2}`}>
          <DesignField fieldId="county" sheet={sheet} onChange={onChange} originalValue={original('county')} />
        </div>
      </SectionBlock>

      {isMarried && (
        <SectionBlock title="Spouse / Partner" subtitle="Co-grantor">
          <div className={sectionFieldGrid2}>
            <DesignField
              fieldId="spouse_name"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_name')}
            />
            <AttorneyInput
              label="Also Known As (AKA)"
              value={sheet.spouse_aka ?? ''}
              placeholder="Other names used (used in Wills)"
              onChange={v => onChange('spouse_aka', v || null)}
            />
          </div>
          <div className={`mt-4 ${sectionFieldGrid3}`}>
            <DesignField
              fieldId="spouse_dob"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_dob')}
              footer={<DobAgeHint dob={sheet.spouse_dob} />}
            />
            <DesignField
              fieldId="spouse_phone"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_phone')}
            />
            <DesignField
              fieldId="spouse_email"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_email')}
            />
          </div>
          <div className={`mt-4 ${sectionFieldGrid2}`}>
            <DesignField
              fieldId="spouse_pronouns"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_pronouns')}
            />
            <DesignField
              fieldId="spouse_citizenship"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('spouse_citizenship')}
              valueOverride={spouseCitizenshipDisplay}
            />
          </div>
          <div className={`mt-4 ${sectionFieldGrid2}`}>
            <DesignField
              fieldId="marriage_date"
              sheet={sheet}
              onChange={onChange}
              originalValue={original('marriage_date')}
            />
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Citizenship & Residency">
        <div className={sectionFieldGrid2}>
          <DesignField
            fieldId="client_citizenship"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_citizenship')}
            valueOverride={citizenshipDisplay}
          />
          <DesignField
            fieldId="client_domicile"
            sheet={sheet}
            onChange={onChange}
            originalValue={original('client_domicile')}
            valueOverride={sheet.client_domicile || sheet.state || ''}
          />
        </div>
      </SectionBlock>
    </DesignSectionContent>
  )
}

/** @deprecated Use ClientInformationSection */
export const PersonalSection = ClientInformationSection
