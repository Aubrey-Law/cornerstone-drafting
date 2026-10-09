import { describe, expect, it } from 'vitest'
import { compileIntakeForm, type CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import { parseIntakeFormDefinition } from '@/lib/intake/forms/schema'
import { addItem, addSection, createBlankDefinition, updateItem } from '@/lib/intake/forms/editorState'
import { getIntakeFormBuilderCatalog } from '@/lib/intake/forms/builderCatalog'
import { evaluateClientForm, formatClientFormAnswer, questionAnswerError, sanitizeClientFormAnswers, clientFormQuestions } from '@/lib/forms/clientFormAnswers'
import { portalReturnPath } from '@/lib/forms/portalReturnPath'
import { safeClientRedirectPath } from '@/lib/auth/safeRedirect'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

const clientForm = (items: unknown[], extra: Record<string, unknown> = {}): IntakeFormDefinition => ({
  purpose: 'client_form', schemaVersion: 1, key: 'followup', title: 'Follow-up',
  sections: [{ id: 's1', title: 'About the student', audience: 'client_and_staff', items, ...extra }],
} as IntakeFormDefinition)

const questions = [
  { kind: 'question', id: 'colleges', label: 'Which colleges?', questionType: 'long_text', required: true },
  { kind: 'question', id: 'housing', label: 'Housing', questionType: 'single_choice', options: ['Dorm', 'Off campus', ''] },
  { kind: 'question', id: 'abroad', label: 'Studying abroad?', questionType: 'yes_no' },
  { kind: 'question', id: 'docs', label: 'Documents you have', questionType: 'multiple_choice', options: ['HIPAA', 'FERPA'] },
  { kind: 'question', id: 'start', label: 'Start date', questionType: 'date' },
  { kind: 'question', id: 'email', label: 'School email', questionType: 'email' },
]

function compiled(): CompiledIntakeForm {
  const result = compileIntakeForm(clientForm(questions), 'client')
  if (!result.success) throw new Error(JSON.stringify(result.errors))
  return result.form
}

describe('client form definitions', () => {
  it('compiles custom questions without a review block, dropping blank choice lines', () => {
    const form = compiled()
    expect(form.purpose).toBe('client_form')
    const housing = clientFormQuestions(form).find(question => question.id === 'housing')!
    expect(housing.options).toEqual(['Dorm', 'Off campus'])
    expect(clientFormQuestions(form).find(question => question.id === 'colleges')!.required).toBe(true)
  })

  it('keeps custom questions out of client intakes and catalog fields out of client forms', () => {
    const intake = compileIntakeForm({ schemaVersion: 1, key: 'x', title: 'X', sections: [{ id: 's', title: 'S', audience: 'client_and_staff', items: [questions[0]] }] }, 'client')
    expect(intake.success).toBe(false)
    if (!intake.success) expect(intake.errors.map(e => e.message)).toContain('Custom questions are only available in client forms')

    const mixed = compileIntakeForm(clientForm([questions[0], { kind: 'field', id: 'f', fieldId: 'client_first_name' }]), 'client')
    expect(mixed.success).toBe(false)
    if (!mixed.success) expect(mixed.errors.map(e => e.message)).toContain('Client forms contain custom questions only')
  })

  it('requires choices for choice questions, a question overall, and shared sections', () => {
    const noChoices = compileIntakeForm(clientForm([{ kind: 'question', id: 'q', label: 'Pick', questionType: 'single_choice', options: [' '] }]), 'client')
    expect(noChoices.success).toBe(false)
    const empty = compileIntakeForm(clientForm([]), 'client')
    expect(empty.success).toBe(false)
    if (!empty.success) expect(empty.errors.map(e => e.message)).toContain('Add at least one question')
    const staffOnly = compileIntakeForm(clientForm([questions[0]], { audience: 'staff_only' }), 'staff')
    expect(staffOnly.success).toBe(false)
  })

  it('rejects unknown question types at the schema boundary', () => {
    expect(parseIntakeFormDefinition(clientForm([{ kind: 'question', id: 'q', label: 'Q', questionType: 'file_upload' }])).success).toBe(false)
  })

  it('has no catalog entries for client forms and only lets editors add questions there', () => {
    expect(getIntakeFormBuilderCatalog('client_form')).toEqual({ fields: [], blocks: [] })
    const base = addSection(createBlankDefinition({ key: 'k', title: 'T', purpose: 'client_form' }), { title: 'S', audience: 'client_and_staff' }, () => 'a')
    const sectionId = base.sections[0].id
    const withQuestion = addItem(base, sectionId, { kind: 'question', label: 'New question', questionType: 'short_text' }, () => 'b')
    const item = withQuestion.sections[0].items[0]
    const updated = updateItem(withQuestion, item.id, { label: 'Renamed', required: true })
    expect(updated.sections[0].items[0]).toMatchObject({ kind: 'question', label: 'Renamed', required: true, questionType: 'short_text' })

    const intake = addSection(createBlankDefinition({ key: 'k', title: 'T' }), { title: 'S', audience: 'client_and_staff' }, () => 'c')
    expect(() => addItem(intake, intake.sections[0].id, { kind: 'question', label: 'Q', questionType: 'short_text' })).toThrow(/client forms/)
  })
})

describe('client form answers', () => {
  it('keeps only answers to known questions, in the expected shape', () => {
    const answers = sanitizeClientFormAnswers(compiled(), { colleges: 'MIT', docs: ['HIPAA'], housing: ['Dorm'], unknown: 'x', abroad: 3 })
    expect(answers).toEqual({ colleges: 'MIT', docs: ['HIPAA'] })
  })

  it('reports missing required answers and invalid formats', () => {
    const form = compiled()
    const blank = evaluateClientForm(form, {})
    expect(blank.issues.map(issue => issue.itemId)).toEqual(['colleges'])
    expect(blank.total).toBe(6)

    const bad = evaluateClientForm(form, { colleges: 'MIT', housing: 'Tent', abroad: 'maybe', docs: ['HIPAA', 'Other'], start: '2027-02-30', email: 'nope' })
    expect(bad.issues.map(issue => issue.itemId).sort()).toEqual(['abroad', 'docs', 'email', 'housing', 'start'])

    const good = evaluateClientForm(form, { colleges: 'MIT', housing: 'Dorm', abroad: 'no', docs: ['FERPA'], start: '2027-08-30', email: 'sam@mit.edu' })
    expect(good.issues).toEqual([])
    expect(good.answered).toBe(6)
  })

  it('formats answers for staff', () => {
    const form = compiled()
    const byId = Object.fromEntries(clientFormQuestions(form).map(question => [question.id, question]))
    expect(formatClientFormAnswer(byId.abroad, 'yes')).toBe('Yes')
    expect(formatClientFormAnswer(byId.docs, ['HIPAA', 'FERPA'])).toBe('HIPAA; FERPA')
    expect(formatClientFormAnswer(byId.colleges, '  ')).toBe('—')
    expect(questionAnswerError(byId.colleges, null)).toBeNull()
  })
})

describe('portal routing for several forms', () => {
  const formId = '3f0c6c5e-8f5a-4e8b-9d55-2f6f1f7b9a10'
  const intakeId = '0b1d7a2e-1c3f-4f4a-8a6b-5e9d3c2b1a00'

  it('opens the invited questionnaire, or a named client form, after the intake link', () => {
    expect(portalReturnPath(undefined, intakeId)).toBe(`/intake?id=${intakeId}`)
    expect(portalReturnPath(`/forms/${formId}`, intakeId)).toBe(`/forms/${formId}`)
    for (const hostile of ['https://evil.test/forms/x', '//evil.test', `/forms/${formId}/../../admin`, '/admin', `/forms/${formId}?x=1`]) {
      expect(portalReturnPath(hostile, intakeId)).toBe(`/intake?id=${intakeId}`)
    }
  })

  it('lets clients be returned to /forms after signing in', () => {
    expect(safeClientRedirectPath(`/forms/${formId}`)).toBe(`/forms/${formId}`)
    expect(safeClientRedirectPath('/forms')).toBe('/forms')
  })
})
