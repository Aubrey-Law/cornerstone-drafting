// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockingCalendarsEditor } from '@/app/admin/settings/BlockingCalendarsEditor'
import type { ExternalCalendarRef } from '@/app/admin/calendar/types'

afterEach(cleanup)

const PRIMARY = 'primary@aubreylegal.com'
const TEAM = 'team@aubreylegal.com'
const HOLIDAYS = 'holidays@group.calendar.google.com'
const RETIRED = 'retired-paralegal@aubreylegal.com'

const calendars: ExternalCalendarRef[] = [
  { id: PRIMARY, name: 'Scott Aubrey', isDefault: true },
  { id: TEAM, name: 'Team calendar', isDefault: false },
  { id: HOLIDAYS, name: 'US Holidays', isDefault: false },
]

function renderEditor(overrides: {
  connected?: boolean
  blockingIds?: string[]
  disabled?: boolean
} = {}) {
  const onChange = vi.fn<(ids: string[]) => void>()
  render(
    <BlockingCalendarsEditor
      calendars={calendars}
      connected={overrides.connected ?? true}
      blockingIds={overrides.blockingIds ?? []}
      disabled={overrides.disabled ?? false}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('BlockingCalendarsEditor', () => {
  it('keeps the primary calendar checked and disabled', () => {
    renderEditor({ blockingIds: [] })

    const primary = screen.getByRole('checkbox', { name: /Scott Aubrey/ })
    expect(primary).toBeChecked()
    expect(primary).toBeDisabled()
  })

  it('adds a newly checked calendar to the blocking list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ blockingIds: [] })

    await user.click(screen.getByRole('checkbox', { name: /Team calendar/ }))

    expect(onChange).toHaveBeenCalledWith([TEAM])
  })

  it('offers to remove a blocking id Google no longer serves', async () => {
    const user = userEvent.setup()
    // A stale id fails every freeBusy call, and fail-closed availability then
    // blocks every slot — so the row has to be both visible and removable.
    const { onChange } = renderEditor({ blockingIds: [TEAM, RETIRED] })

    const staleRow = screen.getByText(RETIRED).closest('div')
    expect(staleRow).not.toBeNull()
    expect(staleRow).toHaveTextContent(/Google no longer serves this calendar/)

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(onChange).toHaveBeenCalledWith([TEAM])
    expect(onChange.mock.calls[0][0]).not.toContain(RETIRED)
  })

  it('renders no calendar checkboxes when Google is not connected', () => {
    renderEditor({ connected: false, blockingIds: [TEAM] })

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.getByText(/Google Calendar is not connected/)).toBeInTheDocument()
  })
})
