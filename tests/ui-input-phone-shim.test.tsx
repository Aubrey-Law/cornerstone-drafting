// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, render, fireEvent } from '@testing-library/react'
import { Input } from '@/components/ui/input'

/**
 * The root app's Input formats `type="tel"` as the user types. That behaviour
 * belongs to this app (it is firm phone-number policy from the drafting
 * engine), not to the shared primitive, so it lives in the root shim. This
 * pins it there through the extraction.
 */
describe('root Input shim keeps tel formatting', () => {
  afterEach(cleanup)

  it('formats a raw tel value on change', () => {
    let seen = ''
    const { getByRole } = render(
      <Input type="tel" onChange={(e) => (seen = e.target.value)} aria-label="Phone" />,
    )
    const input = getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '6175551234' } })
    expect(seen).toBe('(617) 555-1234')
  })

  it('leaves other input types alone', () => {
    let seen = ''
    const { getByRole } = render(<Input type="text" onChange={(e) => (seen = e.target.value)} aria-label="Name" />)
    fireEvent.change(getByRole('textbox'), { target: { value: '6175551234' } })
    expect(seen).toBe('6175551234')
  })
})
