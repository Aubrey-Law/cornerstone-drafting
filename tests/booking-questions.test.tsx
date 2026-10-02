// @vitest-environment jsdom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BookingWidget, { type BookingWidgetType } from '@/components/scheduling/BookingWidget'
import { BookingQuestionsEditor } from '@/app/admin/settings/BookingQuestionsEditor'
import { QuickBookPopover } from '@/app/admin/calendar/QuickBookPopover'
import {
  type BookingQuestion,
  BookingAnswerValidationError,
  MAX_BOOKING_QUESTIONS,
  parseBookingAnswers,
  resolveBookingAnswers,
  sanitizeBookingQuestions,
} from '@/lib/appointments/bookingQuestions'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('sanitizeBookingQuestions', () => {
  it('keeps valid questions, trims, and drops blanks, bad choices and duplicates', () => {
    const result = sanitizeBookingQuestions([
      { id: 'a', label: '  Why   now? ', kind: 'short_text', required: true },
      { id: 'b', label: '', kind: 'short_text' },
      { id: 'c', label: 'Pick one', kind: 'choice', options: ['Only one', ' ', 'Only one'] },
      { id: 'd', label: 'Pick', kind: 'choice', options: [' Phone ', 'Video', 'Video', ''] },
      { id: 'a', label: 'Duplicate id', kind: 'bogus' },
      'not an object',
    ])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ id: 'a', label: 'Why now?', kind: 'short_text', required: true, options: [] })
    expect(result[1]).toEqual({ id: 'd', label: 'Pick', kind: 'choice', required: false, options: ['Phone', 'Video'] })
    // Duplicate id is reissued; unknown kind falls back to short answer.
    expect(result[2].id).not.toBe('a')
    expect(result[2].kind).toBe('short_text')
  })

  it('caps the number of questions and tolerates non-arrays', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `q${i}`, label: `Q${i}`, kind: 'short_text' }))
    expect(sanitizeBookingQuestions(many)).toHaveLength(MAX_BOOKING_QUESTIONS)
    expect(sanitizeBookingQuestions(null)).toEqual([])
    expect(sanitizeBookingQuestions({ id: 'x' })).toEqual([])
  })
})

describe('resolveBookingAnswers', () => {
  const questions: BookingQuestion[] = [
    { id: 'reason', label: 'Reason', kind: 'long_text', required: true, options: [] },
    { id: 'kids', label: 'Kids?', kind: 'yes_no', required: false, options: [] },
    { id: 'heard', label: 'Heard via', kind: 'choice', required: false, options: ['Referral', 'Google'] },
  ]

  it('returns answers in question order, keeping paragraph line breaks', () => {
    expect(resolveBookingAnswers(questions, { heard: 'Google', reason: ' Line one\nLine two ', extra: 'x' })).toEqual([
      { questionId: 'reason', label: 'Reason', answer: 'Line one\nLine two' },
      { questionId: 'heard', label: 'Heard via', answer: 'Google' },
    ])
  })

  it.each([
    [{}, 'Please answer: Reason'],
    [{ reason: '   ' }, 'Please answer: Reason'],
    [{ reason: 'x', kids: 'Maybe' }, 'Please answer yes or no: Kids?'],
    [{ reason: 'x', heard: 'Billboard' }, 'Please choose one of the options for: Heard via'],
  ])('rejects %j', (answers, message) => {
    expect(() => resolveBookingAnswers(questions, answers)).toThrow(BookingAnswerValidationError)
    expect(() => resolveBookingAnswers(questions, answers)).toThrow(message)
  })

  it('can skip required questions for staff while still checking choices', () => {
    expect(resolveBookingAnswers(questions, { kids: 'Yes' }, { enforceRequired: false })).toEqual([
      { questionId: 'kids', label: 'Kids?', answer: 'Yes' },
    ])
    expect(() => resolveBookingAnswers(questions, { heard: 'Billboard' }, { enforceRequired: false })).toThrow(
      BookingAnswerValidationError,
    )
  })

  it('treats a missing answers object as no answers', () => {
    expect(resolveBookingAnswers(questions.slice(1), undefined)).toEqual([])
  })
})

describe('parseBookingAnswers', () => {
  it('reads stored rows defensively', () => {
    expect(parseBookingAnswers([{ questionId: 'a', label: 'L', answer: 'A' }, { label: 1 }, null])).toEqual([
      { questionId: 'a', label: 'L', answer: 'A' },
    ])
    expect(parseBookingAnswers('nope')).toEqual([])
  })
})

describe('booking widget questions', () => {
  const slot = new Date(new Date().setHours(14, 0, 0, 0)).toISOString()
  const type: BookingWidgetType = {
    key: 'discovery_call', slug: 'discovery-call', label: 'Discovery Call', description: '', durationMinutes: 30, locationType: 'teams',
    bookingQuestions: [
      { id: 'reason', label: 'What prompted you to reach out?', kind: 'long_text', required: true, options: [] },
      { id: 'kids', label: 'Do you have minor children?', kind: 'yes_no', required: false, options: [] },
      { id: 'heard', label: 'How did you hear about us?', kind: 'choice', required: false, options: ['Referral', 'Google'] },
    ],
  }

  it('asks the questions on the details step and submits the answers', async () => {
    const posted: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        return { ok: true, json: async () => ({ ok: true, startTime: slot }) }
      }
      return { ok: true, json: async () => ({ slots: [slot] }) }
    }))
    render(<BookingWidget type={type} />)
    fireEvent.click(await screen.findByRole('button', { name: new Date(slot).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }, { timeout: 5000 }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Continue' })[0])

    const reason = screen.getByLabelText('What prompted you to reach out?') as HTMLTextAreaElement
    expect(reason.required).toBe(true)
    expect(screen.getByText('Do you have minor children?').parentElement?.textContent).toContain('(optional)')

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Mary' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Jones' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mary@example.com' } })
    fireEvent.change(reason, { target: { value: 'We just had a baby' } })
    fireEvent.click(screen.getByLabelText('Yes'))
    fireEvent.click(screen.getByLabelText('Google'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    await screen.findByText("You're booked")
    expect(posted[0].answers).toEqual({ reason: 'We just had a baby', kids: 'Yes', heard: 'Google' })
  })
})

describe('BookingQuestionsEditor', () => {
  function Harness({ onState }: { onState: (q: BookingQuestion[]) => void }) {
    const [value, setValue] = useState<BookingQuestion[]>([])
    return <BookingQuestionsEditor value={value} onChange={next => { setValue(next); onState(next) }} />
  }

  it('adds, edits, reorders and removes questions', () => {
    let state: BookingQuestion[] = []
    render(<Harness onState={q => { state = q }} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add question' }))
    fireEvent.change(screen.getByLabelText('Question 1'), { target: { value: 'First?' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add question' }))
    fireEvent.change(screen.getByLabelText('Question 2'), { target: { value: 'Second?' } })
    fireEvent.change(screen.getAllByLabelText('Answer type')[1], { target: { value: 'choice' } })
    expect(screen.getByText(/Add at least two options/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Options (one per line)'), { target: { value: 'A\nB' } })
    fireEvent.click(screen.getAllByLabelText('Required')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Move question 2 up' }))
    expect(state.map(q => q.label)).toEqual(['Second?', 'First?'])
    expect(state[0]).toMatchObject({ kind: 'choice', options: ['A', 'B'], required: true })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    expect(state.map(q => q.label)).toEqual(['Second?'])
  })
})

describe('QuickBookPopover booking questions', () => {
  it('lets staff answer the type\'s questions and submits them', async () => {
    const posted: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        return { ok: true, json: async () => ({ ok: true }) }
      }
      return { ok: true, json: async () => ({ connected: true, slots: [] }) }
    }))
    const slot = new Date(Date.now() + 86_400_000).toISOString()
    render(
      <QuickBookPopover
        open
        onOpenChange={vi.fn()}
        prefillIso={slot}
        authHeaders={() => undefined}
        onBooked={vi.fn()}
        types={[{
          id: 'type-1', label: 'Discovery Call', durationMinutes: 30, locationType: 'phone', locationTypes: ['phone'], active: true,
          bookingQuestions: [
            { id: 'reason', label: 'What prompted you to reach out?', kind: 'long_text', required: true, options: [] },
            { id: 'heard', label: 'How did you hear about us?', kind: 'choice', required: false, options: ['Referral', 'Google'] },
          ],
        }]}
      />,
    )
    expect(screen.getByText('(required for clients)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Mary' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Jones' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'mary@example.com' } })
    fireEvent.change(screen.getByLabelText(/How did you hear about us/), { target: { value: 'Google' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book & email confirmation' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].answers).toEqual({ heard: 'Google' })
  })
})
