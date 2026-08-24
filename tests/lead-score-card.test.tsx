// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { computeLeadScore, type LeadScoreInput } from '@/lib/leads/score'
import { LeadScoreCard } from '@/components/leads/LeadScoreCard'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

afterEach(cleanup)

const BASE: LeadScoreInput = {
  leadStatus: 'lead',
  intakeSentAt: null,
  intakeCompletedAt: null,
  intakeStatus: null,
  engagementStatus: null,
  engagementSentAt: null,
  engagementSignedAt: null,
  feeQuoted: null,
  billingType: null,
  taxableEstate: null,
  hasMinorChildren: null,
  urgency: null,
  leadSource: null,
  lastTouchAt: null,
  createdAt: null,
  nextAppointmentAt: null,
  readinessPercent: null,
}

function card(overrides: Partial<LeadScoreInput> = {}) {
  const score = computeLeadScore({ ...BASE, ...overrides })
  render(<LeadScoreCard leadId="lead-1" score={score} leadStatus="lead" />)
  return score
}

describe('the lead score card', () => {
  it('leads with the score and why, not with eight bars', () => {
    // Eight factors, each with a bar and a sentence, is most of a side panel
    // for a number the reader usually agrees with at a glance.
    card({ leadSource: 'Client referral', nextAppointmentAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })

    expect(screen.getByText(/Referral/)).toBeTruthy()
    // The breakdown is not rendered until it is asked for.
    expect(screen.queryByText('Pipeline progress')).toBeNull()
  })

  it('gives the full breakdown back on demand', async () => {
    const user = userEvent.setup()
    card({ leadSource: 'Client referral' })

    await user.click(screen.getByRole('button', { name: /Referral/ }))

    expect(screen.getByText('Pipeline progress')).toBeTruthy()
    expect(screen.getByText('Revenue signal')).toBeTruthy()
    expect(screen.getByText('Lead score')).toBeTruthy()
  })

  it('says what a lead with nothing recorded is missing', () => {
    card()

    expect(screen.getByText(/Nothing scored yet/)).toBeTruthy()
  })

  it('shows the questions nobody has asked as unasked, not as failures', async () => {
    const user = userEvent.setup()
    // A lead with no fee quoted has not failed the revenue test; nobody has
    // asked it yet, and the band leaves it out of the denominator.
    card({ leadSource: 'Client referral' })

    await user.click(screen.getByRole('button', { name: /Referral/ }))

    expect(screen.getAllByText('not asked').length).toBeGreaterThan(0)
    expect(screen.getByText(/points on offer so far/)).toBeTruthy()
  })
})
