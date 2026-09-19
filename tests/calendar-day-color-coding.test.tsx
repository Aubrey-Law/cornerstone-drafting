// @vitest-environment jsdom

import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DayAgenda } from '@/app/admin/calendar/DayAgenda'
import { BLOCK_HATCH, CATEGORY_LABEL, CATEGORY_STYLE, categorize } from '@/app/admin/calendar/eventCategories'
import type { CalendarAppointment, CalendarRailData, ExternalCalendarEvent } from '@/app/admin/calendar/types'

afterEach(cleanup)

const rail: CalendarRailData = { datesThisWeek: [], followUps: [], openSlots: [] }

function appointment(overrides: Partial<CalendarAppointment> & Pick<CalendarAppointment, 'id'>): CalendarAppointment {
  return {
    startTime: '2026-07-30T14:00:00.000Z', endTime: '2026-07-30T15:00:00.000Z',
    status: 'scheduled', locationType: 'teams', secondAttendeeName: null, secondAttendeeEmail: null,
    attendeeName: 'Jane Alpha', attendeeEmail: 'jane@example.com', attendeePhone: null, notes: null,
    typeLabel: 'Discovery call', source: 'internal', calendarSynced: true, onlineMeetingUrl: null,
    linkedMatterId: null, linkedMatterNumber: null, linkedMatterStage: null, linkedMatterPlanType: null,
    linkedLeadId: null,
    ...overrides,
  }
}

function externalEvent(overrides: Partial<ExternalCalendarEvent> & Pick<ExternalCalendarEvent, 'id' | 'subject'>): ExternalCalendarEvent {
  return {
    startIso: '2026-07-30T18:00:00.000Z', endIso: '2026-07-30T19:00:00.000Z',
    isAllDay: false, showAs: 'busy',
    ...overrides,
  }
}

function renderDay(props: {
  appointments?: CalendarAppointment[]
  calendarEvents?: ExternalCalendarEvent[]
}) {
  return render(
    <DayAgenda
      date={new Date('2026-07-30T12:00:00.000Z')}
      appointments={props.appointments ?? []}
      calendarEvents={props.calendarEvents ?? []}
      attention={[]}
      rail={rail}
      onDismissAttention={vi.fn()}
      onOpenAppointment={vi.fn()}
      onReschedule={vi.fn()}
      onBookSlot={vi.fn()}
    />,
  )
}

describe('day calendar colour coding', () => {
  it('labels each appointment with its category using the month grid tokens', () => {
    renderDay({
      appointments: [
        appointment({ id: 'a', typeLabel: 'Discovery call', attendeeName: 'Jane Alpha' }),
        appointment({ id: 'b', typeLabel: 'Signing appointment', attendeeName: 'Zoe Beta' }),
      ],
    })

    expect(screen.getByText('Discovery')).toBeTruthy()
    expect(screen.getByText('Signing')).toBeTruthy()

    const discovery = screen.getByText('Discovery').parentElement as HTMLElement
    expect(discovery.style.background).toBe(CATEGORY_STYLE.discovery.bg)
    expect(discovery.style.color).toBe(CATEGORY_STYLE.discovery.text)
  })

  it('carries the category accent on the card edge like a month cell', () => {
    renderDay({ appointments: [appointment({ id: 'a', typeLabel: 'Design review' })] })

    const card = screen.getByText('Jane Alpha').closest('article') as HTMLElement
    expect(card.style.borderLeft).toContain(CATEGORY_STYLE.draft.dot)
  })

  it('colour codes external calendar events the same way', () => {
    renderDay({ calendarEvents: [externalEvent({ id: 'o1', subject: 'Estate plan sync' })] })

    expect(categorize('Estate plan sync')).toBe('meeting')
    const strip = screen.getByText('Client meeting').parentElement as HTMLElement
    expect(strip.style.background).toBe(CATEGORY_STYLE.meeting.bg)
  })

  it('keeps external calendar blocks as hatched background, not coloured events', () => {
    renderDay({ calendarEvents: [externalEvent({ id: 'o2', subject: 'BLOCK admin time' })] })

    const block = screen.getByText('BLOCK admin time') as HTMLElement
    expect(block.style.backgroundImage).toBe(BLOCK_HATCH)
    expect(screen.queryByText(CATEGORY_LABEL.internal)).toBeNull()
  })

  it('uses theme tokens rather than literal colours so both themes work', () => {
    for (const style of Object.values(CATEGORY_STYLE)) {
      expect(style.bg.startsWith('var(--')).toBe(true)
      expect(style.text.startsWith('var(--')).toBe(true)
      expect(style.dot.startsWith('var(--')).toBe(true)
    }
  })
})

describe('calendar category legend', () => {
  // The legend visibility is a ternary inside a className, with no test hook on
  // the element. Rather than pin the exact expression, lift the condition out of
  // the source and evaluate it per view — any equivalent phrasing still passes.
  function legendVisibility(): (view: string) => boolean {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/calendar/CalendarClient.tsx'),
      'utf8',
    )
    const match = source.match(/([^\n]*?)\s*\?\s*'flex'\s*:\s*'hidden'/)
    if (!match) throw new Error('legend visibility ternary not found in CalendarClient.tsx')
    return new Function('view', `return Boolean(${match[1]})`) as (view: string) => boolean
  }

  it('shows the category key on every view that colours events by category', () => {
    const visible = legendVisibility()

    // Month, week and day all render events with CATEGORY_STYLE tokens.
    for (const view of ['month', 'week', 'day']) {
      expect(visible(view)).toBe(true)
    }
    // Plan is the only view with no colour-coded events, so it needs no key.
    expect(visible('plan')).toBe(false)
  })
})
