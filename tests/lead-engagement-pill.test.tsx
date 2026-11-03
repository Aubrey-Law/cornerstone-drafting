// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadOverview } from '@/components/leads/LeadOverview'
import { LeadEngagementPill } from '@/components/leads/LeadEngagementPill'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => null }))

const lead = { id: 'lead-1', lead_status: 'lead' } as unknown as LeadDetailRecord
const props = {
  lead, nextAppointmentAt: null, lastContactAt: null, lastResponseAt: null, updatedAt: null,
  timeZone: 'America/New_York', taskCount: 0, tasksVersion: 0,
  onIntake: () => {}, onTasks: () => {}, onSchedule: () => {},
}

afterEach(cleanup)

describe('LeadEngagementPill', () => {
  const open = async (name: RegExp) => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name }))
    return user
  }

  it('records the send when the box is ticked', async () => {
    const onEngagementSentOutside = vi.fn(async () => {})
    render(<LeadEngagementPill agreementStatus="draft" engagementSentOutside={false} onEngagementSentOutside={onEngagementSentOutside} onEngagement={() => {}} />)
    const user = await open(/Engagement: Draft/)
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Sent outside the app' }))
    expect(onEngagementSentOutside).toHaveBeenCalledWith(true)
  })

  it('shows a recorded send as ticked, and the status as Sent', async () => {
    render(<LeadEngagementPill agreementStatus="sent" engagementSentOutside onEngagementSentOutside={vi.fn(async () => {})} onEngagement={() => {}} />)
    await open(/Engagement: Sent/)
    expect(screen.getByRole('menuitemcheckbox', { name: 'Sent outside the app' }).getAttribute('data-state')).toBe('checked')
  })

  it('offers nothing once signed, or when the app sent it itself', async () => {
    const view = render(<LeadEngagementPill agreementStatus="signed" engagementSentOutside onEngagementSentOutside={vi.fn(async () => {})} onEngagement={() => {}} />)
    await open(/Engagement: Signed/)
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Sent outside the app' })).toBeNull()
    view.unmount()
    render(<LeadEngagementPill agreementStatus="viewed" engagementSentOutside={undefined} onEngagementSentOutside={vi.fn(async () => {})} onEngagement={() => {}} />)
    await open(/Engagement: Viewed/)
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Sent outside the app' })).toBeNull()
  })

  it('reads Not prepared without an agreement, and opens the engagement details', async () => {
    const onEngagement = vi.fn()
    render(<LeadEngagementPill onEngagement={onEngagement} />)
    const user = await open(/Engagement: Not prepared/)
    await user.click(screen.getByRole('menuitem', { name: 'View engagement details' }))
    expect(onEngagement).toHaveBeenCalled()
  })
})


describe('LeadOverview next steps', () => {
  it('keeps a completed intake available behind a disclosure', async () => {
    render(<LeadOverview {...props} lead={{ ...lead, intake_completed_at: '2026-09-01' }} />)
    const summary = screen.getByText('Completed steps (1)')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Intake received')
    await userEvent.setup().click(summary)
    expect(details.open).toBe(true)
    expect(screen.getByRole('button', { name: 'Review intake' })).toBeTruthy()
  })

  it('leaves the engagement to the header pill', () => {
    render(<LeadOverview {...props} />)
    expect(screen.queryByRole('heading', { name: 'Engagement' })).toBeNull()
  })

  it('uses the recorded meeting label only while that meeting is upcoming', () => {
    const view = render(<LeadOverview {...props} nextAppointmentAt="2099-01-01" nextAppointmentLabel="Discovery Call" />)
    expect(screen.getByRole('heading', { name: 'Discovery Call' })).toBeTruthy()
    view.rerender(<LeadOverview {...props} nextAppointmentAt="2000-01-01" nextAppointmentLabel="Discovery Call" />)
    expect(screen.queryByRole('heading', { name: 'Discovery Call' })).toBeNull()
    expect(screen.getByText('No meeting scheduled')).toBeTruthy()
  })
})
