// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MatterOverviewFacts } from '@/app/admin/matters/[id]/MatterOverviewFacts'
import { EMPTY_PLAN_MIRROR } from '@/lib/matter/planMirror'
import type { PipelineMatter } from '@/types/database'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'
afterEach(cleanup)
function setup(status: string) {
  const onDetails = vi.fn()
  render(<MatterOverviewFacts matter={{ client_name: 'Alex Client', marital_status: status, spouse_name: 'Sam Client', spouse_email: 'sam@example.com', spouse_phone: '617-555-0111', spouse_address: '20 Main Street' } as PipelineMatter}
    details={null} plan={EMPTY_PLAN_MIRROR} estate={{ assetCount: 0 } as MatterEstateSnapshot} onDetails={onDetails} />)
  return onDetails
}
it('shows compact read-only client and spouse cards with a details-panel action', () => {
  const edit = setup('married')
  expect(screen.getByRole('heading', { name: 'Matter summary' })).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Client summary' })).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Spouse summary' })).toBeTruthy()
  for (const text of ['Alex Client', 'Sam Client', 'sam@example.com', '617-555-0111', '20 Main Street']) expect(screen.getByText(text)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }))
  expect(edit).toHaveBeenCalledOnce()
})
it('leaves opened and last-contact dates to the details panel', () => {
  render(<MatterOverviewFacts
    matter={{ client_name: 'Alex Client', marital_status: 'single', opened_at: '2026-06-18T13:02:00.000Z' } as PipelineMatter}
    details={null}
    plan={EMPTY_PLAN_MIRROR}
    estate={{ assetCount: 0 } as MatterEstateSnapshot}
    onDetails={vi.fn()}
  />)
  expect(screen.queryByText('Opened')).toBeNull()
  expect(screen.queryByText('Last contact')).toBeNull()
})
it('does not display stale spouse details for an unmarried client', () => {
  setup('divorced')
  expect(screen.queryByRole('heading', { name: 'Spouse' })).toBeNull()
  expect(screen.queryByText('Sam Client')).toBeNull()
})
