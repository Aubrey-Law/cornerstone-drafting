// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ReadFirstPanel } from '@/app/admin/matters/[id]/ReadFirstPanel'

afterEach(cleanup)

describe('read-first panel', () => {
  it('starts in read mode and returns there after editing', async () => {
    const user = userEvent.setup()
    render(
      <ReadFirstPanel title="Matter essentials" readView={<p>Formatted value</p>}>
        <label>Editable field<input /></label>
      </ReadFirstPanel>,
    )

    expect(screen.getByText('Formatted value')).toBeTruthy()
    expect(screen.queryByLabelText('Editable field')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Editable field')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('Formatted value')).toBeTruthy()
  })

  it('announces saving, saved, and persistent error states', () => {
    const { rerender } = render(
      <ReadFirstPanel title="Panel" readView={<p>Value</p>} savingField="plan_type">
        <input />
      </ReadFirstPanel>,
    )
    expect(screen.getByRole('status').textContent).toContain('Saving…')

    rerender(
      <ReadFirstPanel title="Panel" readView={<p>Value</p>} lastSavedAt="2026-07-24T12:00:00Z">
        <input />
      </ReadFirstPanel>,
    )
    expect(screen.getByRole('status').textContent).toContain('Saved')

    rerender(
      <ReadFirstPanel title="Panel" readView={<p>Value</p>} error="Save failed">
        <input />
      </ReadFirstPanel>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Save failed')
  })

  it('keeps edit mode open when a save error is reported', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ReadFirstPanel title="Panel" readView={<p>Value</p>}>
        <label>Editable field<input /></label>
      </ReadFirstPanel>,
    )
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    rerender(
      <ReadFirstPanel title="Panel" readView={<p>Value</p>} error="Save failed">
        <label>Editable field<input /></label>
      </ReadFirstPanel>,
    )
    expect(screen.getByLabelText('Editable field')).toBeTruthy()
  })
})
