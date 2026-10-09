'use client'
import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getFormField, type DiscoveryFieldId } from '@/lib/discovery/catalog'
export function DiscoveryField({ id, value, label, required, disabled, helpText, onChange }: {
  id: DiscoveryFieldId; value: unknown; label?: string; required?: boolean; disabled?: boolean; helpText?: string; onChange: (value: unknown) => void
}) {
  const inputId = useId(), def = getFormField(id), text = typeof value === 'string' ? value : ''
  const props = { id: inputId, disabled, 'aria-required': required, 'aria-describedby': helpText ? `${inputId}-help` : undefined }
  return <fieldset disabled={disabled} className="min-w-0 space-y-2">
    <label htmlFor={inputId} className="text-sm font-medium">{label ?? def.label}{required ? ' *' : ''}</label>
    {def.control === 'textarea' ? <Textarea {...props} value={text} onChange={e => onChange(e.target.value)} rows={3} />
      : def.control === 'multiselect' ? <div id={inputId} role="group" aria-label={label ?? def.label} className="grid gap-2 sm:grid-cols-2">
        {def.options?.map(option => <label key={option.value} className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={Array.isArray(value) && value.includes(option.value)} onChange={e => {
          const values = Array.isArray(value) ? value : []; onChange(e.target.checked ? [...values, option.value] : values.filter(v => v !== option.value))
        }} />{option.label}</label>)}
      </div> : def.control === 'select' ? <select {...props} className="w-full rounded-md border bg-background p-2 text-sm" value={text} onChange={e => onChange(e.target.value)}>
        <option value="">Not answered</option>{text && !def.options?.some(o => o.value === text) && <option value={text}>{text} (previous value)</option>}
        {def.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select> : <Input {...props} type={id === 'discovery_call_at' ? 'datetime-local' : def.control === 'email' ? 'email' : def.control === 'tel' ? 'tel' : 'text'}
        inputMode={id === 'discovery_duration' || id === 'discovery_estimate' ? 'decimal' : undefined} value={text} onChange={e => onChange(e.target.value)} />}
    {helpText && <p id={`${inputId}-help`} className="text-sm text-muted-foreground">{helpText}</p>}
  </fieldset>
}
