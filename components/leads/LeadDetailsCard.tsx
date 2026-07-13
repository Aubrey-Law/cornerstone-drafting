'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export type LeadForm = Record<string, string> & { spousePresent: string }

const fields = [
  ['firstName', 'First name'], ['middleName', 'Middle name'], ['lastName', 'Last name'],
  ['preferredName', 'Preferred name'], ['email', 'Email'], ['phone', 'Phone'],
  ['dateOfBirth', 'Date of birth'], ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'], ['city', 'City'], ['state', 'State'],
  ['zip', 'ZIP'], ['county', 'County'], ['source', 'Lead source'], ['fee', 'Fee'],
] as const

const qualificationFields = [
  ['estimatedEstateValue', 'Estimated estate value'],
] as const

const spouseFields = [
  ['spouseFirstName', 'Spouse first name'], ['spouseMiddleName', 'Spouse middle name'],
  ['spouseLastName', 'Spouse last name'], ['spousePreferredName', 'Spouse preferred name'],
  ['spouseEmail', 'Spouse email'], ['spousePhone', 'Spouse phone'],
  ['spouseDateOfBirth', 'Spouse date of birth'],
] as const

const enumerations = [
  ['maritalStatus', 'Marital status', [['single', 'Single'], ['married', 'Married'], ['divorced', 'Divorced'], ['widowed', 'Widowed']]],
  ['practiceArea', 'Practice area', [['EP', 'Estate planning'], ['PROBATE', 'Probate'], ['ELDER', 'Elder law']]],
  ['status', 'Status', [['lead', 'Lead'], ['hired', 'Hired'], ['lost', 'Lost']]],
] as const

const qualificationEnumerations = [
  ['urgency', 'Urgency', [['unset', 'Not set'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]],
  ['minorChildren', 'Minor children', [['unset', 'Not set'], ['yes', 'Yes'], ['no', 'No']]],
] as const

type Props = {
  lead: {
    full_name?: string | null
    email?: string | null
    phone?: string | null
    address_line1?: string | null
    city?: string | null
    state?: string | null
    zip?: string | null
    marital_status?: string | null
    lead_source?: string | null
    engagement_fee_quoted?: number | null
    lead_urgency?: string | null
    taxable_estate?: number | null
    has_minor_children?: boolean | null
    qualification_notes?: string | null
  }
  spouse: { first_name?: string | null; last_name?: string | null } | null
  editing: boolean
  form: LeadForm
  error: string | null
  fieldErrors?: Record<string, string>
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  onChange: (key: string, value: string) => void
  onRemoveSpouse: () => void
}

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? <span id={`lead-${field}-error`} className="text-xs text-destructive">{errors[field]}</span> : null
}

export function LeadDetailsCard({ lead, spouse, editing, form, error, fieldErrors = {}, busy, onEdit, onCancel, onSave, onChange, onRemoveSpouse }: Props) {
  return (
    <section className="rounded-lg border p-5">
      <div className="flex items-center justify-between">
        <div><h2 className="font-semibold">Details</h2><p className="text-xs text-muted-foreground">Contact, household, and qualification details.</p></div>
        {!editing && <Button variant="outline" onClick={onEdit}>Edit</Button>}
      </div>
      {editing ? (
        <form noValidate onSubmit={event => { event.preventDefault(); onSave() }}>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {fields.map(([key, label]) => (
              <label key={key} htmlFor={`lead-${key}`} className="text-sm">
                {label}
                <Input id={`lead-${key}`} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `lead-${key}-error` : undefined} type={key.includes('date') || key === 'dateOfBirth' ? 'date' : key === 'email' ? 'email' : key === 'fee' ? 'number' : 'text'} value={form[key]} onChange={event => onChange(key, event.target.value)} />
                <FieldError field={key} errors={fieldErrors} />
              </label>
            ))}
            {enumerations.map(([key, label, options]) => (
              <div key={key} className="text-sm">
                <label id={`lead-${key}-label`}>{label}</label>
                <Select value={form[key]} onValueChange={value => onChange(key, value)}>
                  <SelectTrigger className="w-full" aria-labelledby={`lead-${key}-label`}><SelectValue /></SelectTrigger>
                  <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <h3 className="mt-6 font-medium">Qualification</h3>
          <p className="text-xs text-muted-foreground">Only the details that help prioritize and prepare the first conversation.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {qualificationFields.map(([key, label]) => (
              <label key={key} htmlFor={`lead-${key}`} className="text-sm">
                {label}
                <Input id={`lead-${key}`} min={0} type="number" value={form[key]} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `lead-${key}-error` : undefined} onChange={event => onChange(key, event.target.value)} />
                <FieldError field={key} errors={fieldErrors} />
              </label>
            ))}
            {qualificationEnumerations.map(([key, label, options]) => (
              <div key={key} className="text-sm">
                <label id={`lead-${key}-label`}>{label}</label>
                <Select value={form[key] || 'unset'} onValueChange={value => onChange(key, value === 'unset' ? '' : value)}>
                  <SelectTrigger className="w-full" aria-labelledby={`lead-${key}-label`}><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <label htmlFor="lead-qualificationNotes" className="text-sm sm:col-span-2">
              Qualification notes
              <Textarea id="lead-qualificationNotes" className="mt-1 min-h-24" value={form.qualificationNotes} onChange={event => onChange('qualificationNotes', event.target.value)} />
            </label>
          </div>

          <h3 className="mt-6 font-medium">Spouse</h3>
          {form.spousePresent === 'yes' ? (
            <>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {spouseFields.map(([key, label]) => (
                  <label key={key} htmlFor={`lead-${key}`} className="text-sm">
                    {label}
                    <Input id={`lead-${key}`} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `lead-${key}-error` : undefined} type={key.includes('Date') ? 'date' : key.includes('Email') ? 'email' : 'text'} value={form[key]} onChange={event => onChange(key, event.target.value)} />
                    <FieldError field={key} errors={fieldErrors} />
                  </label>
                ))}
              </div>
              <Button type="button" className="mt-3" variant="outline" onClick={onRemoveSpouse}>Remove spouse</Button>
            </>
          ) : <Button type="button" className="mt-3" variant="outline" onClick={() => onChange('spousePresent', 'yes')}>Add spouse</Button>}
          {error && <p className="mt-3 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>}
          <div className="mt-5 flex gap-2"><Button type="submit" disabled={busy}>Save</Button><Button type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button></div>
        </form>
      ) : (
        <dl className="mt-4 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-5 gap-y-3 text-sm">
          <dt>Name</dt><dd>{lead.full_name}</dd>
          <dt>Email</dt><dd>{lead.email}</dd>
          <dt>Phone</dt><dd>{lead.phone || '—'}</dd>
          <dt>Address</dt><dd>{[lead.address_line1, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Marital status</dt><dd>{lead.marital_status || '—'}</dd>
          <dt>Spouse</dt><dd>{spouse ? [spouse.first_name, spouse.last_name].filter(Boolean).join(' ') : '—'}</dd>
          <dt>Lead source</dt><dd>{lead.lead_source || '—'}</dd>
          <dt>Fee</dt><dd>{lead.engagement_fee_quoted ? `$${Number(lead.engagement_fee_quoted).toLocaleString()}` : '—'}</dd>
          <dt>Urgency</dt><dd className="capitalize">{lead.lead_urgency || '—'}</dd>
          <dt>Estate value</dt><dd>{lead.taxable_estate ? `$${Number(lead.taxable_estate).toLocaleString()}` : '—'}</dd>
          <dt>Minor children</dt><dd>{lead.has_minor_children == null ? '—' : lead.has_minor_children ? 'Yes' : 'No'}</dd>
          <dt>Qualification notes</dt><dd className="whitespace-pre-wrap">{lead.qualification_notes || '—'}</dd>
        </dl>
      )}
    </section>
  )
}
