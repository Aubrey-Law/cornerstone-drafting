'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ClientFormAnswer, ClientFormQuestion } from '@/lib/forms/clientFormAnswers'

const inputTypes: Partial<Record<ClientFormQuestion['questionType'], string>> = {
  short_text: 'text', email: 'email', phone: 'tel', date: 'date', number: 'text',
}

/** One custom question from a client form. Values are plain strings / string arrays. */
export function CustomQuestionField({ question, value, onChange, disabled = false, error }: {
  question: Pick<ClientFormQuestion, 'id' | 'label' | 'questionType' | 'options' | 'required' | 'helpText'>
  value: ClientFormAnswer | undefined
  onChange: (value: ClientFormAnswer) => void
  disabled?: boolean
  error?: string | null
}) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [question.helpText ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const label = <>{question.label || 'Untitled question'}{question.required ? <span aria-hidden className="text-destructive"> *</span> : <span className="ml-1 text-xs font-normal text-muted-foreground">(optional)</span>}</>
  const text = typeof value === 'string' ? value : ''
  const footer = <>
    {question.helpText ? <p id={helpId} className="text-sm text-muted-foreground">{question.helpText}</p> : null}
    {error ? <p id={errorId} className="text-sm text-destructive">{error}</p> : null}
  </>

  if (question.questionType === 'single_choice' || question.questionType === 'multiple_choice' || question.questionType === 'yes_no') {
    const multiple = question.questionType === 'multiple_choice'
    const options = question.questionType === 'yes_no' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : question.options.map(option => ({ value: option, label: option }))
    const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
    return <fieldset disabled={disabled} aria-describedby={describedBy} aria-required={question.required || undefined} className="min-w-0 space-y-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{label}</legend>
      <div className="space-y-1.5">
        {options.map(option => <label key={option.value} className="flex items-start gap-2 text-sm">
          <input
            type={multiple ? 'checkbox' : 'radio'}
            name={id}
            className="mt-0.5"
            checked={selected.includes(option.value)}
            onChange={event => {
              if (!multiple) { onChange(option.value); return }
              const next = event.target.checked ? [...selected, option.value] : selected.filter(choice => choice !== option.value)
              // Keep the stored order the same as the form's, whatever order they were ticked in.
              onChange(options.map(o => o.value).filter(choice => next.includes(choice)))
            }}
          />
          <span>{option.label}</span>
        </label>)}
      </div>
      {footer}
    </fieldset>
  }

  return <div className="space-y-1">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    {question.questionType === 'long_text'
      ? <Textarea id={id} value={text} disabled={disabled} maxLength={10000} rows={4} aria-describedby={describedBy} aria-invalid={error ? true : undefined} required={question.required} onChange={event => onChange(event.target.value)} />
      : <Input id={id} type={inputTypes[question.questionType] ?? 'text'} inputMode={question.questionType === 'number' ? 'decimal' : undefined} value={text} disabled={disabled} maxLength={10000} aria-describedby={describedBy} aria-invalid={error ? true : undefined} required={question.required} onChange={event => onChange(event.target.value)} />}
    {footer}
  </div>
}
