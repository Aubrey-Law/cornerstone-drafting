'use client'

import {
  getSharedField,
  getBuilderField,
  estateValueLabel,
  inputTypeForControl,
  type SharedFieldContext,
  type SharedFieldId,
} from '../core'

type IntakeFieldProps = {
  fieldId: SharedFieldId
  value: unknown
  onChange: (value: unknown) => void
  variant?: 'select' | 'pills'
  context?: SharedFieldContext
  placeholder?: string
  id?: string
  required?: boolean
  disabled?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  /** Merge classes for pill buttons and inputs. Default: portal intake styling. */
  classNames?: {
    pill?: (active: boolean) => string
    select?: string
    input?: string
  }
}

function stringValue(raw: unknown): string {
  if (raw == null) return ''
  return typeof raw === 'string' ? raw : String(raw)
}

const defaultPillClass = (active: boolean) =>
  active
    ? 'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors border-accent bg-accent text-white'
    : 'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors border-border bg-white text-foreground hover:border-input'

const defaultControlClass =
  'w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

export function IntakeField({
  fieldId,
  value,
  onChange,
  variant = 'select',
  context,
  placeholder,
  id,
  required,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  classNames,
}: IntakeFieldProps) {
  const sharedDef = getSharedField(fieldId)
  const def = sharedDef.builderEnabled ? getBuilderField(fieldId) : sharedDef
  const options = def.optionsFor ? def.optionsFor(context ?? {}) : def.options ?? []
  const display = def.normalize ? (def.normalize(value) ?? '') : stringValue(value).trim()
  const raw = stringValue(value).trim()
  const legacyValue = def.legacyValues?.includes(raw) && !options.some((option) => option.value === raw) ? raw : null
  const legacyLabel = legacyValue && fieldId === 'estate_value' ? estateValueLabel(legacyValue) : legacyValue
  const controlA11y = { disabled, 'aria-label': ariaLabel, 'aria-describedby': ariaDescribedBy }

  const commit = (next: string) => {
    const normalized = def.normalize ? def.normalize(next) : next.trim() || null
    onChange(normalized ?? (next.trim() === '' ? null : next.trim()))
  }

  if (def.control === 'select' && variant === 'pills') {
    const pillClass = classNames?.pill ?? defaultPillClass
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel} aria-describedby={ariaDescribedBy}>
        {legacyValue && <span>{legacyLabel}</span>}
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => commit(opt.value)}
            aria-pressed={display === opt.value}
            className={pillClass(display === opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  if (def.control === 'select') {
    return (
      <select
        id={id}
        value={legacyValue ?? display}
        {...controlA11y}
        required={required}
        onChange={(e) => commit(e.target.value)}
        className={classNames?.select ?? defaultControlClass}
      >
        <option value="">{placeholder ?? def.placeholder ?? 'Select an option'}</option>
        {legacyValue && <option value={legacyValue} disabled>{legacyLabel}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }

  if (def.control === 'textarea') {
    return (
      <textarea
        id={id}
        {...controlA11y}
        value={stringValue(value)}
        required={required}
        maxLength={def.maxLength}
        placeholder={placeholder ?? def.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        className={classNames?.input ?? defaultControlClass}
      />
    )
  }

  if (def.control === 'boolean') {
    // Requiredness means answering the question; a false answer is valid.
    // Native checkbox `required` would incorrectly demand a true answer.
    return <input id={id} {...controlA11y} type="checkbox" checked={value === true} aria-required={required} onChange={(event) => onChange(event.target.checked)} />
  }

  if (def.control === 'multiselect') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : [])
    return (
      <fieldset id={id} {...controlA11y} aria-required={required} className="space-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.has(option.value)}
              onChange={(event) => {
                const next = new Set(selected)
                if (event.target.checked) next.add(option.value)
                else next.delete(option.value)
                onChange([...next])
              }}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    )
  }

  const inputType = inputTypeForControl(def.control)
  const preserveEditingText = def.builderEnabled && def.control === 'text'
  return (
    <input
      id={id}
      {...controlA11y}
      type={inputType}
      value={preserveEditingText ? stringValue(value) : display}
      required={required}
      maxLength={def.maxLength}
      placeholder={placeholder ?? def.placeholder}
      onChange={(event) => preserveEditingText ? onChange(event.target.value) : commit(event.target.value)}
      onBlur={preserveEditingText ? (event) => commit(event.target.value) : undefined}
      className={classNames?.input ?? defaultControlClass}
    />
  )
}
