'use client'

import {
  getSharedField,
  inputTypeForControl,
  sharedFieldOptions,
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
  classNames,
}: IntakeFieldProps) {
  const def = getSharedField(fieldId)
  const options = sharedFieldOptions(fieldId, context ?? {})
  const display = def.normalize ? (def.normalize(value) ?? '') : stringValue(value).trim()

  const commit = (next: string) => {
    const normalized = def.normalize ? def.normalize(next) : next.trim() || null
    onChange(normalized ?? (next.trim() === '' ? null : next.trim()))
  }

  if (def.control === 'select' && variant === 'pills') {
    const pillClass = classNames?.pill ?? defaultPillClass
    return (
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
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
        value={display}
        required={required}
        onChange={(e) => commit(e.target.value)}
        className={classNames?.select ?? defaultControlClass}
      >
        {(placeholder ?? def.placeholder) && (
          <option value="">{placeholder ?? def.placeholder}</option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }

  const inputType = inputTypeForControl(def.control)
  return (
    <input
      id={id}
      type={inputType}
      value={display}
      required={required}
      placeholder={placeholder ?? def.placeholder}
      onChange={(e) => commit(e.target.value)}
      className={classNames?.input ?? defaultControlClass}
    />
  )
}
