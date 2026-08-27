// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSettledDateEntry } from '@/lib/firmDate'
import { InlineDate } from '@/app/admin/matters/[id]/facts-panel/InlineField'
import { LeadFieldsRail } from '@/components/leads/LeadFieldsRail'
import { LeadKeyDatesCard } from '@/components/leads/LeadKeyDatesCard'

/**
 * `<input type="date">` reports "" until all three segments hold something, and
 * a complete date the instant they do — including while the year is still being
 * typed. Entering 2026 passes through 0002, 0020 and 0202, each a valid date the
 * browser hands to `onChange`.
 *
 * Both date surfaces saved on change, so the first of those saved and closed the
 * row. Entering a date took one segment per attempt, and a lead is carrying a
 * 1969 milestone as a result (matter 77b0a409, flagged `stage_clock_suspect`).
 */

afterEach(cleanup)

describe('when a date entry has settled', () => {
  it('waits for the whole year, which every prefix of a real one fails', () => {
    // The exact sequence Chrome emits while 2026 is typed into the year.
    expect(isSettledDateEntry('0002-09-02')).toBe(false)
    expect(isSettledDateEntry('0020-09-02')).toBe(false)
    expect(isSettledDateEntry('0202-09-02')).toBe(false)
    expect(isSettledDateEntry('2026-09-02')).toBe(true)
  })

  it('treats mid-entry blanks and malformed values as unfinished', () => {
    expect(isSettledDateEntry('')).toBe(false)
    expect(isSettledDateEntry('2026-09')).toBe(false)
    expect(isSettledDateEntry('2026')).toBe(false)
    expect(isSettledDateEntry('not-a-date')).toBe(false)
  })

  it('accepts the old dates the app legitimately stores', () => {
    // Dates of birth reach back further than anything else the app records.
    expect(isSettledDateEntry('1958-04-12')).toBe(true)
    expect(isSettledDateEntry('1900-01-01')).toBe(true)
  })
})

const lead = {
  id: 'lead-1', matter_id: 'matter-1', full_name: 'Jane Doe', email: 'jane@example.com',
  phone: '617', date_of_birth: null, address_line1: null, address_line2: null, city: null,
  state: null, zip: null, county: null, lead_source: null, lead_urgency: null,
  engagement_fee_quoted: null, estimated_estate_value: null, billing_type: null,
  practice_area: 'estate_planning', lead_status: 'lead', status: 'new',
  created_at: '2026-07-21T12:00:00Z', updated_at: '2026-07-25T10:00:00Z',
  additional_channels: null, notes: null, spouse_intake_id: null,
} as never

describe('the opportunity key date field', () => {
  it('stays open through the year, then saves once', async () => {
    const onSaveKeyDate = vi.fn().mockResolvedValue(undefined)
    render(
      <LeadKeyDatesCard
        keyDates={{ discoveryCallAt: null, pmpsAt: null }}
        onSaveKeyDate={onSaveKeyDate}
      />,
    )

    const input = screen.getByLabelText('Discovery date')
    for (const partial of ['', '0002-09-02', '0020-09-02', '0202-09-02']) {
      fireEvent.change(input, { target: { value: partial } })
    }
    // Nothing saved, and the row was never closed out from under the typing.
    expect(onSaveKeyDate).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '2026-09-02' } })
    await waitFor(() => expect(onSaveKeyDate).toHaveBeenCalledWith('discoveryCallAt', '2026-09-02'))
    expect(onSaveKeyDate).toHaveBeenCalledTimes(1)
  })
})

describe('the rail\'s click-to-edit date editor', () => {
  it('holds the row open through the year rather than committing a prefix', async () => {
    const user = userEvent.setup()
    const onSaveField = vi.fn().mockResolvedValue(undefined)
    function Harness() {
      const [field, setField] = React.useState<string | null>(null)
      return (
        <LeadFieldsRail
          lead={lead}
          spouse={null}
          activeField={field as never}
          onActiveFieldChange={next => setField(next)}
          onSaveField={onSaveField}
          onRemoveSpouse={vi.fn()}
        />
      )
    }
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Add Date of birth' }))
    const input = screen.getByLabelText('Date of birth')
    for (const partial of ['', '0001-04-12', '0019-04-12', '0195-04-12']) {
      fireEvent.change(input, { target: { value: partial } })
    }
    expect(onSaveField).not.toHaveBeenCalled()
    // The editor is still there, so the rest of the year can be typed into it.
    expect(screen.getByLabelText('Date of birth')).toBe(input)

    fireEvent.change(input, { target: { value: '1958-04-12' } })
    await waitFor(() => expect(onSaveField).toHaveBeenCalledWith('dateOfBirth', '1958-04-12'))
  })
})

describe('the matter facts panel date field', () => {
  it('does not overwrite a stored date with a year still being typed', () => {
    const onSave = vi.fn()
    render(<InlineDate label="Signing date" value="2026-10-01" onSave={onSave} />)

    const input = screen.getByLabelText('Signing date')
    for (const partial of ['', '0002-09-02', '0020-09-02', '0202-09-02']) {
      fireEvent.change(input, { target: { value: partial } })
    }
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '2026-09-02' } })
    expect(onSave).toHaveBeenCalledWith('2026-09-02')
  })

  it('still clears a date that is emptied and left', () => {
    const onSave = vi.fn()
    render(<InlineDate label="Signing date" value="2026-10-01" onSave={onSave} />)

    const input = screen.getByLabelText('Signing date')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input, { target: { value: '' } })
    expect(onSave).toHaveBeenCalledWith('')
  })
})
