// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatterStageStrip } from '@/app/admin/matters/[id]/MatterStageStrip'

afterEach(cleanup)

function renderStrip(onStageChange = vi.fn()) {
  render(
    <MatterStageStrip
      stage="drafting"
      details={null}
      agingSummary={null}
      stageSaving={false}
      onStageChange={onStageChange}
    />,
  )
  return onStageChange
}

describe('MatterStageStrip', () => {
  it('keeps the progress rail read-only and changes stage through an explicit confirmation', async () => {
    const user = userEvent.setup()
    const onStageChange = renderStrip()

    expect(screen.queryByRole('button', { name: 'Revision' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Change stage' }))

    await user.selectOptions(screen.getByRole('combobox', { name: 'New stage' }), 'revision')
    expect(onStageChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm stage change' }))
    expect(onStageChange).toHaveBeenCalledOnce()
    expect(onStageChange).toHaveBeenCalledWith('revision')
  })

  it('keeps closing behind the Billing close-out flow', async () => {
    const user = userEvent.setup()
    renderStrip()

    await user.click(screen.getByRole('button', { name: 'Change stage' }))

    expect(screen.queryByRole('option', { name: 'Closed' })).toBeNull()
    expect(screen.getByText(/Close this matter from Billing/)).toBeTruthy()
  })
})
