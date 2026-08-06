// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MatterDetailsCard } from '@/app/admin/matters/[id]/MatterDetailsCard'
import type { PipelineMatter } from '@/types/database'

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

const matter = {
  matter_id: 'm1',
  client_name: 'Jane Doe',
  practice_area: 'EP',
  plan_type: 'TBD',
  signing_date: null,
  fee_amount: 4500,
  referral_source: null,
} as unknown as PipelineMatter

function renderCard(details: Record<string, unknown> | null, onSaveField = vi.fn()) {
  render(
    <MatterDetailsCard
      matter={matter}
      matterId="m1"
      matterNumber={null}
      matterStatus="active"
      onStatusChange={vi.fn()}
      details={details}
      onSaveField={onSaveField}
      esignEnabled
    />,
  )
  return onSaveField
}

afterEach(() => cleanup())

describe('matter essentials engagement dropdown', () => {
  it('shows the derived status in the read view', () => {
    renderCard({ engagement_status: 'draft' })
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('shows Signed when only the legacy boolean is set', () => {
    renderCard({ engagement_signed: true })
    expect(screen.getByText('Signed')).toBeTruthy()
  })

  it('saves a manually chosen status through the dropdown', async () => {
    const user = userEvent.setup()
    const onSaveField = renderCard({ engagement_sent_at: '2026-07-01T00:00:00Z' })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const trigger = screen.getByRole('combobox', { name: 'Engagement status' })
    expect(trigger.textContent).toContain('Sent')

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Signed' }))

    expect(onSaveField).toHaveBeenCalledWith('engagement_status', 'signed')
  })

  it('offers exactly the four manual statuses', async () => {
    const user = userEvent.setup()
    renderCard(null)

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('combobox', { name: 'Engagement status' }))

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Not sent', 'Draft', 'Sent', 'Signed',
    ])
  })

  it('hides the send buttons once signed', async () => {
    const user = userEvent.setup()
    renderCard({ engagement_status: 'signed', engagement_signed: true })

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('button', { name: /send engagement/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Draft engagement' })).toBeNull()
  })
})
