/**
 * Custom questions an appointment type asks when a client books it.
 *
 * Staff configure them per type in Settings → Scheduling (stored on
 * `appointment_types.booking_questions`); the client answers them on the
 * details step of /book/[slug]; the answers are snapshotted with each
 * question's label onto `appointments.booking_answers`, so later edits to a
 * question never change what an existing booking shows.
 *
 * Pure module: imported by the booking widget, the settings UI and the server.
 */

export const BOOKING_QUESTION_KINDS = ['short_text', 'long_text', 'choice', 'yes_no'] as const
export type BookingQuestionKind = (typeof BOOKING_QUESTION_KINDS)[number]

export const BOOKING_QUESTION_KIND_LABELS: Record<BookingQuestionKind, string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  choice: 'Multiple choice',
  yes_no: 'Yes / No',
}

export const MAX_BOOKING_QUESTIONS = 10
export const MAX_QUESTION_LABEL = 200
export const MAX_QUESTION_OPTIONS = 10
export const MAX_OPTION_LENGTH = 100
export const MAX_ANSWER_LENGTH: Record<BookingQuestionKind, number> = {
  short_text: 200,
  long_text: 2000,
  choice: MAX_OPTION_LENGTH,
  yes_no: 3,
}

export interface BookingQuestion {
  /** Stable across label edits; answers are keyed by it. */
  id: string
  label: string
  kind: BookingQuestionKind
  required: boolean
  /** `choice` only: the options, in display order. */
  options: string[]
}

/** What a booking stores: the question as it read when the client answered. */
export interface BookingAnswer {
  questionId: string
  label: string
  answer: string
}

export class BookingAnswerValidationError extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

function isKind(value: unknown): value is BookingQuestionKind {
  return typeof value === 'string' && (BOOKING_QUESTION_KINDS as readonly string[]).includes(value)
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function newBookingQuestionId(): string {
  return `q_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Validate a stored or submitted question list. Drops questions without a
 * label, choice questions without at least two options, and duplicate ids;
 * caps counts and lengths. Never throws, so a malformed row can't break booking.
 */
export function sanitizeBookingQuestions(value: unknown): BookingQuestion[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: BookingQuestion[] = []
  for (const raw of value) {
    if (result.length >= MAX_BOOKING_QUESTIONS) break
    if (!raw || typeof raw !== 'object') continue
    const q = raw as Record<string, unknown>
    const label = cleanText(q.label, MAX_QUESTION_LABEL)
    if (!label) continue
    const kind: BookingQuestionKind = isKind(q.kind) ? q.kind : 'short_text'
    let id = typeof q.id === 'string' && ID_RE.test(q.id) ? q.id : newBookingQuestionId()
    while (seen.has(id)) id = newBookingQuestionId()
    let options: string[] = []
    if (kind === 'choice') {
      const list = Array.isArray(q.options) ? q.options : []
      options = [...new Set(list.map(o => cleanText(o, MAX_OPTION_LENGTH)).filter(Boolean))].slice(
        0,
        MAX_QUESTION_OPTIONS,
      )
      if (options.length < 2) continue
    }
    seen.add(id)
    result.push({ id, label, kind, required: q.required === true, options })
  }
  return result
}

/**
 * Check a client's answers (`{ [questionId]: string }`) against the type's
 * questions and return the snapshot to store, in question order. Unknown ids
 * are ignored; blank optional answers are omitted.
 *
 * @throws BookingAnswerValidationError with a client-facing message.
 */
export function resolveBookingAnswers(
  questions: BookingQuestion[],
  input: unknown,
): BookingAnswer[] {
  const answers =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const result: BookingAnswer[] = []
  for (const q of questions) {
    const raw = answers[q.id]
    const answer =
      typeof raw === 'string'
        ? (q.kind === 'long_text' ? raw.trim() : raw.replace(/\s+/g, ' ').trim()).slice(
            0,
            MAX_ANSWER_LENGTH[q.kind],
          )
        : ''
    if (!answer) {
      if (q.required) throw new BookingAnswerValidationError(`Please answer: ${q.label}`)
      continue
    }
    if (q.kind === 'choice' && !q.options.includes(answer)) {
      throw new BookingAnswerValidationError(`Please choose one of the options for: ${q.label}`)
    }
    if (q.kind === 'yes_no' && answer !== 'Yes' && answer !== 'No') {
      throw new BookingAnswerValidationError(`Please answer yes or no: ${q.label}`)
    }
    result.push({ questionId: q.id, label: q.label, answer })
  }
  return result
}

/** Read stored answers back defensively (jsonb column; never throws). */
export function parseBookingAnswers(value: unknown): BookingAnswer[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const a = item as Record<string, unknown>
    if (typeof a.label !== 'string' || typeof a.answer !== 'string') return []
    return [{ questionId: typeof a.questionId === 'string' ? a.questionId : '', label: a.label, answer: a.answer }]
  })
}

/** Plain-text block for calendar descriptions and alert emails. */
export function formatBookingAnswers(answers: BookingAnswer[]): string {
  return answers.map(a => `${a.label}\n${a.answer}`).join('\n\n')
}
