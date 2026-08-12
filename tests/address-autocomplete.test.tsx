// @vitest-environment jsdom

import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AddressAutocomplete } from '@/components/address-autocomplete'

const PREDICTIONS = [
  {
    description: '42 Larchmont Rd, Newton, MA, USA',
    place_id: 'p1',
    structured_formatting: { main_text: '42 Larchmont Rd', secondary_text: 'Newton, MA, USA' },
  },
]

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => PREDICTIONS }) as Response))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The 400ms debounce, plus a tick for the fetch promise. */
async function settleSearch() {
  await act(async () => {
    vi.advanceTimersByTime(450)
  })
}

describe('AddressAutocomplete', () => {
  it('stays quiet when a stored address simply renders', async () => {
    render(
      <AddressAutocomplete
        value="42 Larchmont Rd, Newton, MA 02459"
        onChange={vi.fn()}
        onPlaceSelected={vi.fn()}
      />,
    )
    await settleSearch()

    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('searches once the operator types, and shuts the list again on Escape', async () => {
    const onChange = vi.fn()
    render(<AddressAutocomplete value="" onChange={onChange} onPlaceSelected={vi.fn()} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '42 Larchmont' } })
    await settleSearch()

    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy())
    expect(onChange).toHaveBeenCalledWith('42 Larchmont')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not reopen the list after a suggestion is picked', async () => {
    const onPlaceSelected = vi.fn()
    function Harness() {
      const [value, setValue] = React.useState('')
      return (
        <AddressAutocomplete
          value={value}
          onChange={setValue}
          onPlaceSelected={parsed => {
            onPlaceSelected(parsed)
            // The panel re-renders with the saved address, as the real one does.
            setValue('42 Larchmont Rd, Newton, MA 02459')
          }}
        />
      )
    }
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('details')
        ? ({ ok: true, json: async () => ({ address_line1: '42 Larchmont Rd', city: 'Newton', state: 'MA', zip: '02459', county: 'Middlesex County' }) } as Response)
        : ({ ok: true, json: async () => PREDICTIONS } as Response),
    )

    render(<Harness />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '42 Larchmont' } })
    await settleSearch()
    await waitFor(() => expect(screen.getByRole('listbox')).toBeTruthy())

    fireEvent.mouseDown(screen.getByText('42 Larchmont Rd'))
    await waitFor(() => expect(onPlaceSelected).toHaveBeenCalled())
    expect(onPlaceSelected.mock.calls[0][0].county).toBe('Middlesex')

    // The value the parent wrote back must not restart the search.
    await settleSearch()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
