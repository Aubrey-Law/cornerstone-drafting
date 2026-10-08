// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MatterAdminRows } from '@/app/admin/matters/[id]/facts-panel/MatterAdminRows'

function renderRows(details: Record<string, unknown> | null, onSaveField = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MatterAdminRows
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

const engagementSelect = () => screen.getByRole('combobox', { name: 'Engagement status' }) as HTMLSelectElement

afterEach(() => cleanup())

describe('matter details engagement dropdown', () => {
  it('shows the derived status', () => {
    renderRows({ engagement_status: 'draft' })
    expect(engagementSelect().value).toBe('draft')
  })

  it('shows Signed when only the legacy boolean is set', () => {
    renderRows({ engagement_signed: true })
    expect(engagementSelect().value).toBe('signed')
  })

  it('saves a manually chosen status through the dropdown', async () => {
    const user = userEvent.setup()
    const onSaveField = renderRows({ engagement_sent_at: '2026-07-01T00:00:00Z' })

    expect(engagementSelect().value).toBe('sent')
    await user.selectOptions(engagementSelect(), 'signed')

    expect(onSaveField).toHaveBeenCalledWith('engagement_status', 'signed')
  })

  it('offers exactly the four manual statuses', () => {
    renderRows(null)
    expect(Array.from(engagementSelect().options).map(option => option.textContent)).toEqual([
      'Not sent', 'Draft', 'Sent', 'Signed',
    ])
  })

  it('hides the send buttons once signed', () => {
    renderRows({ engagement_status: 'signed', engagement_signed: true })
    expect(screen.queryByRole('button', { name: /send engagement/i })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Draft engagement' })).toBeNull()
  })
})
