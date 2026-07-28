'use client'

import {
  ContactAddressFields,
  FormField,
  PhoneInput,
  Row2,
  SectionDivider,
  SelectInput,
  TextInput,
  ToggleSwitch,
} from '@/components/intake/IntakeFormPrimitives'
import { IntakeField } from '@/components/sharedFields/IntakeField'
import { SUFFIX_OPTIONS } from '@/lib/sharedFields'

import type { StepProps } from './IntakeWizard'

const SUFFIXES = SUFFIX_OPTIONS.map((option) => option.value)

export function StepPersonal({ data, update }: StepProps) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="First Name">
          <TextInput value={data.first_name as string} onChange={(value) => update('first_name', value)} required />
        </FormField>
        <FormField label="Middle Name">
          <TextInput value={(data.middle_name as string) ?? ''} onChange={(value) => update('middle_name', value)} />
        </FormField>
        <FormField label="Last Name">
          <TextInput value={data.last_name as string} onChange={(value) => update('last_name', value)} required />
        </FormField>
        <FormField label="Suffix">
          <SelectInput
            value={(data.suffix as string) ?? ''}
            onChange={(value) => update('suffix', value)}
            placeholder="—"
            options={SUFFIXES.map((suffix) => ({ value: suffix, label: suffix }))}
          />
        </FormField>
      </div>
      <Row2>
        <FormField label="Prior Name (maiden/former)">
          <TextInput value={(data.prior_name as string) ?? ''} onChange={(value) => update('prior_name', value)} />
        </FormField>
        <FormField label="Preferred Name">
          <TextInput value={(data.preferred_name as string) ?? ''} onChange={(value) => update('preferred_name', value)} />
        </FormField>
      </Row2>
      <Row2>
        <FormField label="Date of Birth">
          <TextInput value={data.date_of_birth as string} onChange={(value) => update('date_of_birth', value)} type="date" />
        </FormField>
        <FormField label="Pronouns">
          <IntakeField
            fieldId="client_pronouns"
            value={data.preferred_pronoun}
            onChange={(value) => update('preferred_pronoun', value)}
            placeholder="Select pronouns"
          />
        </FormField>
      </Row2>
      <ToggleSwitch
        checked={(data.is_us_citizen as boolean) ?? true}
        onChange={(value) => update('is_us_citizen', value)}
        label="U.S. Citizen"
      />
      <SectionDivider title="Contact Information" />
      <Row2>
        <FormField label="Email">
          <TextInput value={data.email as string} onChange={(value) => update('email', value)} type="email" />
        </FormField>
        <FormField label="Phone">
          <PhoneInput value={data.phone as string} onChange={(value) => update('phone', value)} />
        </FormField>
      </Row2>
      <SectionDivider title="Address" />
      <ContactAddressFields
        street={(data.street_address as string) ?? ''}
        city={(data.city as string) ?? ''}
        state={(data.state as string) ?? 'MA'}
        zip={(data.zip as string) ?? ''}
        county={(data.county as string) ?? ''}
        onStreetChange={(value) => update('street_address', value)}
        onCityChange={(value) => update('city', value)}
        onStateChange={(value) => update('state', value)}
        onZipChange={(value) => update('zip', value)}
        onCountyChange={(value) => update('county', value)}
        onAddressSelect={(address) => {
          update('street_address', address.street)
          update('city', address.city)
          update('state', address.state || 'MA')
          update('zip', address.zip)
          if (address.county) update('county', address.county)
        }}
      />
      <p className="text-xs text-gray-400">Search to auto-fill, or enter manually below.</p>
    </div>
  )
}
