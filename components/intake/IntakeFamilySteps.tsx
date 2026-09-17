'use client'

import {
  FormField,
  InfoBox,
  PhoneInput,
  Row2,
  SectionDivider,
  SelectInput,
  TextInput,
} from '@/components/intake/IntakeFormPrimitives'
import { IntakeField } from '@/components/sharedFields/IntakeField'
import {
  CITIZENSHIP_STATUS_OPTIONS,
  SUFFIX_OPTIONS,
  citizenshipStatusToLegacyBoolean,
  normalizeCitizenshipStatus,
} from '@/lib/sharedFields'
import { cn } from '@/lib/utils'

import type { StepProps } from './IntakeWizard'

const SUFFIXES = SUFFIX_OPTIONS.map((option) => option.value)

export function StepFamily({ data, update }: StepProps) {
  return (
    <div className="space-y-6">
      <FormField label="Marital Status">
        <IntakeField
          fieldId="marital_status"
          value={data.marital_status}
          onChange={(value) => update('marital_status', value)}
          variant="pills"
        />
      </FormField>

      <FormField label="Do you have children?">
        <div className="flex flex-wrap gap-2">
          {[
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                update('has_children', option.value)
                if (!option.value) update('has_minor_children', false)
              }}
              aria-pressed={data.has_children === option.value}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                data.has_children === option.value
                  ? 'border-accent bg-accent text-white'
                  : 'border-border bg-white text-foreground hover:border-input',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </FormField>

      {Boolean(data.has_children) && (
        <FormField label="Do you have children under 18?">
          <div className="flex flex-wrap gap-2">
            {[
              { value: true, label: 'Yes' },
              { value: false, label: 'No' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => update('has_minor_children', option.value)}
                aria-pressed={data.has_minor_children === option.value}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                  data.has_minor_children === option.value
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-white text-foreground hover:border-input',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </FormField>
      )}

      <InfoBox>
        The information you share here helps us understand your family situation so we can prepare
        the right documents. If you are married, we&apos;ll ask about your spouse next.
        If you have children, we&apos;ll collect their details in a following step.
      </InfoBox>
    </div>
  )
}

export function StepSpouse({ data, update }: StepProps) {
  const spouse = (data._spouse as Record<string, string>) ?? {}
  const spouseCitizenshipStatus = normalizeCitizenshipStatus(
    spouse.citizenship_status,
    typeof (spouse as Record<string, unknown>).is_us_citizen === 'boolean'
      ? (spouse as Record<string, unknown>).is_us_citizen as boolean
      : null,
  )

  function updateSpouse(field: string, value: string | boolean) {
    update('_spouse', { ...spouse, [field]: value })
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="First Name">
          <TextInput value={spouse.first_name ?? ''} onChange={(value) => updateSpouse('first_name', value)} required />
        </FormField>
        <FormField label="Middle Name">
          <TextInput value={spouse.middle_name ?? ''} onChange={(value) => updateSpouse('middle_name', value)} />
        </FormField>
        <FormField label="Last Name">
          <TextInput value={spouse.last_name ?? ''} onChange={(value) => updateSpouse('last_name', value)} required />
        </FormField>
        <FormField label="Suffix">
          <SelectInput
            value={spouse.suffix ?? ''}
            onChange={(value) => updateSpouse('suffix', value)}
            placeholder="—"
            options={SUFFIXES.map((suffix) => ({ value: suffix, label: suffix }))}
          />
        </FormField>
      </div>
      <Row2>
        <FormField label="Prior Name (maiden/former)">
          <TextInput value={spouse.prior_name ?? ''} onChange={(value) => updateSpouse('prior_name', value)} />
        </FormField>
        <FormField label="Preferred Name">
          <TextInput value={spouse.preferred_name ?? ''} onChange={(value) => updateSpouse('preferred_name', value)} />
        </FormField>
      </Row2>
      <Row2>
        <FormField label="Date of Marriage">
          <TextInput
            value={(data.date_of_marriage as string) ?? ''}
            onChange={(value) => update('date_of_marriage', value)}
            type="date"
          />
        </FormField>
        <FormField label="Date of Birth">
          <TextInput value={spouse.date_of_birth ?? ''} onChange={(value) => updateSpouse('date_of_birth', value)} type="date" />
        </FormField>
      </Row2>
      <Row2>
        <FormField label="Pronouns">
          <IntakeField
            fieldId="spouse_pronouns"
            value={spouse.preferred_pronoun}
            onChange={(value) => updateSpouse('preferred_pronoun', String(value ?? ''))}
            placeholder="Select pronouns"
          />
        </FormField>
        <div />
      </Row2>
      <FormField label="Citizenship / immigration status">
        <SelectInput
          value={spouseCitizenshipStatus}
          onChange={(value) => {
            const status = normalizeCitizenshipStatus(value)
            update('_spouse', {
              ...spouse,
              citizenship_status: status,
              is_us_citizen: citizenshipStatusToLegacyBoolean(status),
            })
          }}
          options={[...CITIZENSHIP_STATUS_OPTIONS]}
        />
      </FormField>
      <SectionDivider title="Contact" />
      <Row2>
        <FormField label="Email">
          <TextInput value={spouse.email ?? ''} onChange={(value) => updateSpouse('email', value)} type="email" />
        </FormField>
        <FormField label="Phone">
          <PhoneInput value={spouse.phone ?? ''} onChange={(value) => updateSpouse('phone', value)} />
        </FormField>
      </Row2>
    </div>
  )
}
