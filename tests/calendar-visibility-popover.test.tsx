// @vitest-environment jsdom

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn(), message: vi.fn() } }))

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarVisibilityPopover } from '@/app/admin/calendar/CalendarVisibilityPopover'
import type { ExternalCalendarRef } from '@/app/admin/calendar/types'

const PRIMARY = 'primary@aubreylegal.com'
const TEAM = 'team@aubreylegal.com'
const HOLIDAYS = 'holidays@group.calendar.google.com'

const calendars: ExternalCalendarRef[] = [
  { id: PRIMARY, name: 'Scott Aubrey', isDefault: true },
  { id: TEAM, name: 'Team calendar', isDefault: false },
  { id: HOLIDAYS, name: 'US Holidays', isDefault: false },
]

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  toastError.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPopover(overrides: {
  hiddenIds?: string[]
  onChange?: (ids: string[]) => void
} = {}) {
  const onChange = overrides.onChange ?? vi.fn()
  render(
    <CalendarVisibilityPopover
      calendars={calendars}
      hiddenIds={overrides.hiddenIds ?? []}
      authHeaders={() => ({ Authorization: 'Bearer test-token' })}
      onChange={onChange}
    />,
  )
  return { onChange }
}

/** Radix renders the content in a portal only once the trigger is clicked. */
async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('calendar-visibility-trigger'))
  await screen.findByText('Show on this calendar')
}

/** The single PUT the component made, with its body parsed. */
function lastPutBody(): { settings: Record<string, unknown> } {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('/api/admin/scheduling/settings')
  expect(init.method).toBe('PUT')
  return JSON.parse(String(init.body))
}

describe('CalendarVisibilityPopover', () => {
  it('counts a hidden calendar in the total but not in the shown tally', () => {
    renderPopover({ hiddenIds: [HOLIDAYS] })

    expect(screen.getByTestId('calendar-visibility-trigger')).toHaveTextContent(
      'Calendars 3 of 4',
    )
  })

  it('keeps the primary calendar checked and disabled even when it is in hiddenIds', async () => {
    const user = userEvent.setup()
    renderPopover({ hiddenIds: [PRIMARY] })
    await openPopover(user)

    const primary = screen.getByRole('checkbox', { name: /Scott Aubrey/ })
    expect(primary).toBeChecked()
    expect(primary).toBeDisabled()
    // The tally agrees: the primary calendar is still shown.
    expect(screen.getByTestId('calendar-visibility-trigger')).toHaveTextContent(
      'Calendars 4 of 4',
    )
  })

  it('puts the unchecked calendar into hiddenCalendarIds', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPopover({ hiddenIds: [] })
    await openPopover(user)

    await user.click(screen.getByRole('checkbox', { name: /Team calendar/ }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(lastPutBody().settings.hiddenCalendarIds).toContain(TEAM)
    expect(onChange).toHaveBeenCalledWith([TEAM])
  })

  it('writes hiddenCalendarIds and nothing else, so the booking policy survives', async () => {
    const user = userEvent.setup()
    renderPopover({ hiddenIds: [] })
    await openPopover(user)

    await user.click(screen.getByRole('checkbox', { name: /Team calendar/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // The settings page writes blockingCalendarIds through this same route. A
    // second key here would post back whatever this component happened to be
    // holding and clobber the firm's booking protection.
    expect(Object.keys(lastPutBody().settings)).toEqual(['hiddenCalendarIds'])
  })

  it('states a disconnected Google account once', async () => {
    const user = userEvent.setup()
    render(
      <CalendarVisibilityPopover
        calendars={[]}
        hiddenIds={[]}
        connected={false}
        error="Google Calendar is not connected"
        authHeaders={() => ({ Authorization: 'Bearer test-token' })}
        onChange={vi.fn()}
      />,
    )
    await openPopover(user)
    expect(screen.getAllByText('Google Calendar is not connected.')).toHaveLength(1)
  })

  it('does not report a change when the save fails', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const { onChange } = renderPopover({ hiddenIds: [] })
    await openPopover(user)

    await user.click(screen.getByRole('checkbox', { name: /Team calendar/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(onChange).not.toHaveBeenCalled()
  })
})
