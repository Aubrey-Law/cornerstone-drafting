import type { CompiledIntakeForm, CompiledIntakeItem } from '@/lib/intake/forms/compiler'

/**
 * Answers to a client form's custom questions. They live only on the sent form
 * (client_form_assignments.answers), keyed by the question's item id — nothing
 * here reads or writes the household record.
 */
export type ClientFormAnswer = string | string[] | null
export type ClientFormAnswers = Record<string, ClientFormAnswer>
export type ClientFormQuestion = Extract<CompiledIntakeItem, { kind: 'question' }>
export interface ClientFormIssue { itemId: string; sectionId: string; label: string; message: string }

const MAX_TEXT = 10000
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function clientFormQuestions(form: CompiledIntakeForm): (ClientFormQuestion & { sectionId: string })[] {
  return form.sections.flatMap(section => section.items.flatMap(item => item.kind === 'question' ? [{ ...item, sectionId: section.id }] : []))
}

function blank(value: ClientFormAnswer | undefined): boolean {
  if (value === null || value === undefined) return true
  return Array.isArray(value) ? value.length === 0 : !value.trim()
}

/** Format checks only; a blank answer is judged by `required`, not here. */
export function questionAnswerError(question: ClientFormQuestion, value: ClientFormAnswer | undefined): string | null {
  if (blank(value)) return null
  if (question.questionType === 'multiple_choice') {
    if (!Array.isArray(value)) return 'Choose from the listed answers.'
    return value.every(choice => question.options.includes(choice)) && new Set(value).size === value.length ? null : 'Choose from the listed answers.'
  }
  if (typeof value !== 'string') return 'Enter a single answer.'
  if (value.length > MAX_TEXT) return 'Keep this answer under 10,000 characters.'
  switch (question.questionType) {
    case 'single_choice': return question.options.includes(value) ? null : 'Choose one of the listed answers.'
    case 'yes_no': return value === 'yes' || value === 'no' ? null : 'Choose yes or no.'
    case 'email': return EMAIL.test(value.trim()) ? null : 'Enter a valid email address.'
    case 'date': {
      const parsed = new Date(`${value}T00:00:00Z`)
      return DATE.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? null : 'Enter a valid date.'
    }
    case 'number': return /^-?\d+(\.\d+)?$/.test(value.replace(/[$,]/g, '').trim()) ? null : 'Enter a number.'
    case 'phone': return value.replace(/\D/g, '').length >= 7 ? null : 'Enter a valid phone number.'
    default: return null
  }
}

/**
 * Keep only answers to this form's questions, in the expected shape. Unknown
 * keys are dropped rather than rejected so an older client tab cannot wedge a
 * save after a form version changes underneath it — a pinned version never does.
 */
export function sanitizeClientFormAnswers(form: CompiledIntakeForm, raw: unknown): ClientFormAnswers {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const answers: ClientFormAnswers = {}
  for (const question of clientFormQuestions(form)) {
    if (!Object.hasOwn(input, question.id)) continue
    const value = input[question.id]
    if (value === null) answers[question.id] = null
    else if (question.questionType === 'multiple_choice') {
      if (Array.isArray(value) && value.length <= 50 && value.every(choice => typeof choice === 'string')) answers[question.id] = value as string[]
    } else if (typeof value === 'string') answers[question.id] = value.slice(0, MAX_TEXT)
  }
  return answers
}

export function evaluateClientForm(form: CompiledIntakeForm, answers: ClientFormAnswers): { issues: ClientFormIssue[]; answered: number; total: number } {
  const questions = clientFormQuestions(form)
  const issues: ClientFormIssue[] = []
  let answered = 0
  for (const question of questions) {
    const value = answers[question.id]
    if (!blank(value)) answered++
    const message = blank(value) ? (question.required ? 'This question is required.' : null) : questionAnswerError(question, value)
    if (message) issues.push({ itemId: question.id, sectionId: question.sectionId, label: question.label, message })
  }
  return { issues, answered, total: questions.length }
}

/** Staff-facing rendering of a stored answer. */
export function formatClientFormAnswer(question: ClientFormQuestion, value: ClientFormAnswer | undefined): string {
  if (blank(value)) return '—'
  if (Array.isArray(value)) return value.join('; ')
  if (question.questionType === 'yes_no') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : String(value)
  return String(value)
}

export const QUESTION_TYPE_LABELS: Record<ClientFormQuestion['questionType'], string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  yes_no: 'Yes / no',
  date: 'Date',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
}
