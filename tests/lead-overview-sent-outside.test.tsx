// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadOverview } from '@/components/leads/LeadOverview'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => null }))

const lead = { id: 'lead-1', lead_status: 'lead' } as unknown as LeadDetailRecord
const props = {
  lead, nextAppointmentAt: null, lastContactAt: null, lastResponseAt: null, updatedAt: null,
  timeZone: 'America/New_York', taskCount: 0, tasksVersion: 0,
  onIntake: () => {}, onEngagement: () => {}, onTasks: () => {}, onSchedule: () => {},
}

afterEach(cleanup)

describe('LeadOverview engagement sent outside the app', () => {
  it('records the send when the box is ticked', async () => {
    const onEngagementSentOutside = vi.fn(async () => {})
    render(<LeadOverview {...props} agreementStatus="draft" engagementSentOutside={false} onEngagementSentOutside={onEngagementSentOutside} />)
    await userEvent.setup().click(screen.getByLabelText('Sent outside the app'))
    expect(onEngagementSentOutside).toHaveBeenCalledWith(true)
  })

  it('shows a recorded send as ticked, and the status as Sent', () => {
    render(<LeadOverview {...props} agreementStatus="sent" engagementSentOutside onEngagementSentOutside={vi.fn(async () => {})} />)
    expect((screen.getByLabelText('Sent outside the app') as HTMLElement).getAttribute('data-state')).toBe('checked')
    expect(screen.getByText('Sent')).toBeTruthy()
  })

  it('offers nothing once signed, or when the app sent it itself', () => {
    const view = render(<LeadOverview {...props} agreementStatus="signed" engagementSentOutside onEngagementSentOutside={vi.fn(async () => {})} />)
    expect(screen.queryByLabelText('Sent outside the app')).toBeNull()
    view.rerender(<LeadOverview {...props} agreementStatus="viewed" engagementSentOutside={undefined} onEngagementSentOutside={vi.fn(async () => {})} />)
    expect(screen.queryByLabelText('Sent outside the app')).toBeNull()
  })
})
