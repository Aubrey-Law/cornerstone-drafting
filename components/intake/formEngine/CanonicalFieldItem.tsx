'use client'
import { DiscoveryField } from '@/components/discovery/DiscoveryField'
import { isDiscoveryField, type FormFieldId } from '@/lib/discovery/catalog'

import { useId } from 'react'
import {
  getBuilderField,
  readBuilderFieldValue,
  writeBuilderFieldValue,
  normalizeCitizenshipStatus,
} from '@aubrey-law/estate-fields/core'
import { IntakeField } from '@aubrey-law/estate-fields/react'
import { FormField, ToggleSwitch } from '@/components/intake/IntakeFormPrimitives'
import { getIntakeTrack } from '@/lib/intakeTrack'

/** The compiler resolves copy and requirements; storage remains catalog-owned. */
export interface CanonicalFieldRenderItem {
  kind: 'field'
  fieldId: FormFieldId
  label?: string
  helpText?: string
  effectiveRequirement: 'optional' | 'recommended' | 'required'
}

type Props = {
  item: CanonicalFieldRenderItem
  data: Readonly<Record<string, unknown>>
  update: (field: string, value: unknown) => void
  disabled?: boolean
}

export function CanonicalFieldItem({ item, data, update, disabled }: Props) {
  const helpId = useId()
  if (isDiscoveryField(item.fieldId)) return <DiscoveryField id={item.fieldId} label={item.label} value={data[item.fieldId]} required={item.effectiveRequirement === 'required'} disabled={disabled} helpText={item.helpText} onChange={value => { if (!disabled) update(item.fieldId, value) }} />
  const def = getBuilderField(item.fieldId)
  const label = item.label ?? def.label
  // Existing college controls have visual defaults only. Resolve canonical
  // citizenship first, preserving richer stored statuses until a user edits.
  if (getIntakeTrack(data) === 'college_prep' && (item.fieldId === 'client_citizenship' || item.fieldId === 'college_comfort_always')) {
    const citizenship = normalizeCitizenshipStatus(data.citizenship_status, typeof data.is_us_citizen === 'boolean' ? data.is_us_citizen : null)
    const raw = readBuilderFieldValue(item.fieldId, data)
    const checked = item.fieldId === 'client_citizenship'
      ? citizenship === 'us_citizen' || citizenship === 'unknown'
      : typeof raw === 'boolean' ? raw : true
    const legacyLabel = item.fieldId === 'client_citizenship' ? 'U.S. citizen' : 'Provide pain relief and comfort care at all times, even if it may hasten death'
    return <fieldset disabled={disabled} aria-describedby={item.helpText ? helpId : undefined} className="min-w-0 border-0 p-0">
      <ToggleSwitch checked={checked} label={label !== def.label ? label : legacyLabel} onChange={(next) => {
        if (!disabled) writeBuilderFieldValue(item.fieldId, item.fieldId === 'client_citizenship' ? next ? 'US Citizen' : 'Non-US — status unconfirmed' : next, update)
      }} />
      {item.helpText ? <p id={helpId} className="text-sm text-muted-foreground">{item.helpText}</p> : null}
    </fieldset>
  }
  return (
    <div className="space-y-1">
      <FormField label={label} optional={item.effectiveRequirement === 'optional'}>
        <IntakeField
          fieldId={item.fieldId}
          value={readBuilderFieldValue(item.fieldId, data)}
          required={item.effectiveRequirement === 'required'}
          disabled={disabled}
          aria-label={label}
          aria-describedby={item.helpText ? helpId : undefined}
          onChange={(next) => {
            if (!disabled) writeBuilderFieldValue(item.fieldId, next, update)
          }}
        />
      </FormField>
      {item.helpText ? <p id={helpId} className="text-sm text-muted-foreground">{item.helpText}</p> : null}
    </div>
  )
}
