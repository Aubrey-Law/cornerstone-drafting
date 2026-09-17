'use client'

import { useId, type ReactNode } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export interface ChoiceOption {
  value: string
  label: string
  /** Optional second line explaining the consequence of picking this. */
  sub?: string
}

/**
 * Single-select cards. Used wherever the firm's paper form printed a column of
 * ☐ boxes that are mutually exclusive — when the DPOA takes effect, HIPAA
 * scope, life-support instruction.
 */
export function ChoiceCards({
  value,
  onChange,
  options,
  legend,
  columns = 1,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly ChoiceOption[]
  legend: string
  columns?: 1 | 2
}) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
        {options.map((option) => {
          const selected = value === option.value
          const id = `${name}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer gap-3 rounded-md border p-3 transition-colors',
                selected ? 'border-accent bg-teal-bg' : 'border-border hover:bg-accent',
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#1b6b72]"
              />
              <span className="min-w-0">
                <span className="block text-sm text-foreground">{option.label}</span>
                {option.sub && (
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{option.sub}</span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Multi-select checkbox grid — the DPOA powers list, HIPAA carve-outs, FERPA records. */
export function CheckboxGrid({
  values,
  onChange,
  options,
  legend,
  columns = 2,
}: {
  values: string[]
  onChange: (values: string[]) => void
  options: readonly ChoiceOption[]
  legend: string
  columns?: 1 | 2
}) {
  const name = useId()

  function toggle(optionValue: string) {
    onChange(
      values.includes(optionValue)
        ? values.filter((v) => v !== optionValue)
        : [...values, optionValue],
    )
  }

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-foreground">{legend}</legend>
      <div className={cn('grid gap-2', columns === 2 && 'sm:grid-cols-2')}>
        {options.map((option) => {
          const checked = values.includes(option.value)
          const id = `${name}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border p-3 transition-colors',
                checked ? 'border-accent bg-teal-bg' : 'border-border hover:bg-accent',
              )}
            >
              <Checkbox id={id} checked={checked} onCheckedChange={() => toggle(option.value)} />
              <span className="text-sm text-foreground">{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Labelled free-text box. Every "tell us more" prompt on the paper form. */
export function NotesField({
  label,
  hint,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string
  hint?: ReactNode
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
      />
    </div>
  )
}

/**
 * The explanatory prose the firm puts in front of each document on the paper
 * form. It is the reason a family understands what they are signing, so it
 * belongs in the questionnaire rather than only in the cover letter.
 */
export function DocumentPrimer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted p-4">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}
