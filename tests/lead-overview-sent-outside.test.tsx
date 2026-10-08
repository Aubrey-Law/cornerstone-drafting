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


describe('LeadOverview next steps', () => {
  it('keeps completed intake and engagement available behind a disclosure', async () => {
    render(<LeadOverview {...props} lead={{ ...lead, intake_completed_at: '2026-09-01', engagement_signed_at: '2026-09-02' }} />)
    const summary = screen.getByText('Completed steps (2)')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Intake received')
    expect(details.textContent).toContain('Signed')
    expect(details.textContent).not.toContain('Not prepared')
    await userEvent.setup().click(summary)
    expect(details.open).toBe(true)
    expect(screen.getByRole('button', { name: 'Review intake' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View engagement details' })).toBeTruthy()
  })

  it('uses the recorded meeting label only while that meeting is upcoming', () => {
    const view = render(<LeadOverview {...props} nextAppointmentAt="2099-01-01" nextAppointmentLabel="Discovery Call" />)
    expect(screen.getByRole('heading', { name: 'Discovery Call' })).toBeTruthy()
    view.rerender(<LeadOverview {...props} nextAppointmentAt="2000-01-01" nextAppointmentLabel="Discovery Call" />)
    expect(screen.queryByRole('heading', { name: 'Discovery Call' })).toBeNull()
    expect(screen.getByText('No meeting scheduled')).toBeTruthy()
  })
})
