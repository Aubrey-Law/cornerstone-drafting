'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel } from '@/lib/practiceArea'

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
  ['status', 'Matter Status', [['lead', 'Lead'], ['hired', 'Hired'], ['lost', 'Lost']]],
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
    practice_area?: string | null
    lead_status?: string | null
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</span>
}

function DetailCell({ label, children, className = '', valueClassName = '' }: { label: string; children: React.ReactNode; className?: string; valueClassName?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <FieldLabel>{label}</FieldLabel>
      <div className={`mt-1 break-words text-sm font-medium text-foreground ${valueClassName}`}>{children || '—'}</div>
    </div>
  )
}

export function LeadDetailsCard({ lead, spouse, editing, form, error, fieldErrors = {}, busy, onEdit, onCancel, onSave, onChange, onRemoveSpouse }: Props) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-sm font-semibold">Lead essentials</h2><p className="text-[11px] text-muted-foreground">Contact, household, and qualification details.</p></div>
        {!editing && <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>}
      </div>
      {editing ? (
        <form noValidate onSubmit={event => { event.preventDefault(); onSave() }}>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fields.map(([key, label]) => (
              <label key={key} htmlFor={`lead-${key}`} className={`${key === 'addressLine1' || key === 'addressLine2' ? 'lg:col-span-2' : ''} space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground [&_input]:normal-case [&_input]:tracking-normal`}>
                {label}
                <Input id={`lead-${key}`} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `lead-${key}-error` : undefined} type={key.includes('date') || key === 'dateOfBirth' ? 'date' : key === 'email' ? 'email' : key === 'fee' ? 'number' : 'text'} value={form[key]} onChange={event => onChange(key, event.target.value)} />
                <FieldError field={key} errors={fieldErrors} />
              </label>
            ))}
            {enumerations.map(([key, label, options]) => (
              <div key={key} className="space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <label id={`lead-${key}-label`}>{label}</label>
                <Select value={form[key]} onValueChange={value => onChange(key, value)}>
                  <SelectTrigger className="w-full" aria-labelledby={`lead-${key}-label`}><SelectValue /></SelectTrigger>
                  <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <div className="space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <label id="lead-practiceArea-label">Practice area</label>
              <Select value={form.practiceArea} onValueChange={value => onChange('practiceArea', value)}>
                <SelectTrigger className="w-full" aria-labelledby="lead-practiceArea-label"><SelectValue /></SelectTrigger>
                <SelectContent>{PRACTICE_AREA_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <h3 className="mt-6 text-sm font-semibold">Qualification</h3>
          <p className="text-[11px] text-muted-foreground">Only the details that help prioritize and prepare the first conversation.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {qualificationFields.map(([key, label]) => (
              <label key={key} htmlFor={`lead-${key}`} className="space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground [&_input]:normal-case [&_input]:tracking-normal">
                {label}
                <Input id={`lead-${key}`} min={0} type="number" value={form[key]} aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `lead-${key}-error` : undefined} onChange={event => onChange(key, event.target.value)} />
                <FieldError field={key} errors={fieldErrors} />
              </label>
            ))}
            {qualificationEnumerations.map(([key, label, options]) => (
              <div key={key} className="space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <label id={`lead-${key}-label`}>{label}</label>
                <Select value={form[key] || 'unset'} onValueChange={value => onChange(key, value === 'unset' ? '' : value)}>
                  <SelectTrigger className="w-full" aria-labelledby={`lead-${key}-label`}><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <label htmlFor="lead-qualificationNotes" className="space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:col-span-2 lg:col-span-4">
              Qualification notes
              <Textarea id="lead-qualificationNotes" className="mt-1 min-h-24" value={form.qualificationNotes} onChange={event => onChange('qualificationNotes', event.target.value)} />
            </label>
          </div>

          <h3 className="mt-6 text-sm font-semibold">Spouse</h3>
          {form.spousePresent === 'yes' ? (
            <>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {spouseFields.map(([key, label]) => (
                  <label key={key} htmlFor={`lead-${key}`} className="space-y-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground [&_input]:normal-case [&_input]:tracking-normal">
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
        <div className="mt-4">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailCell label="Name">{lead.full_name}</DetailCell>
            <DetailCell label="Email">{lead.email}</DetailCell>
            <DetailCell label="Phone">{lead.phone}</DetailCell>
            <DetailCell label="Matter status" valueClassName="capitalize">{lead.lead_status || form.status}</DetailCell>
            <DetailCell label="Address" className="sm:col-span-2">{[lead.address_line1, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}</DetailCell>
            <DetailCell label="Marital status" valueClassName="capitalize">{lead.marital_status}</DetailCell>
            <DetailCell label="Spouse">{spouse ? [spouse.first_name, spouse.last_name].filter(Boolean).join(' ') : null}</DetailCell>
            <DetailCell label="Practice area">{practiceAreaLabel(lead.practice_area)}</DetailCell>
            <DetailCell label="Lead source">{lead.lead_source}</DetailCell>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailCell label="Quoted fee">{lead.engagement_fee_quoted != null ? `$${Number(lead.engagement_fee_quoted).toLocaleString()}` : null}</DetailCell>
              <DetailCell label="Urgency" valueClassName="capitalize">{lead.lead_urgency}</DetailCell>
              <DetailCell label="Estimated estate value">{lead.taxable_estate != null ? `$${Number(lead.taxable_estate).toLocaleString()}` : null}</DetailCell>
              <DetailCell label="Minor children">{lead.has_minor_children == null ? null : lead.has_minor_children ? 'Yes' : 'No'}</DetailCell>
              <DetailCell label="Qualification notes" className="sm:col-span-2 lg:col-span-4" valueClassName="whitespace-pre-wrap font-normal">{lead.qualification_notes}</DetailCell>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
