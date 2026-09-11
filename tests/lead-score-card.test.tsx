// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

/** The card as the lead page renders it, with the handlers wired. */
function actionableCard(
  overrides: Partial<LeadScoreInput> = {},
  props: Partial<React.ComponentProps<typeof LeadScoreCard>> = {},
) {
  const onFillField = vi.fn()
  const onIntent = vi.fn()
  render(
    <LeadScoreCard
      leadId="lead-1"
      score={computeLeadScore({ ...BASE, ...overrides })}
      leadStatus="lead"
      onFillField={onFillField}
      onIntent={onIntent}
      {...props}
    />,
  )
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  return { onFillField, onIntent }
}

describe('the lead score card', () => {
  it('leads with the score and why, not with eight bars', () => {
    // Eight factors, each with a bar and a sentence, is most of a side panel
    // for a number the reader usually agrees with at a glance.
    card({ leadSource: 'Client referral', nextAppointmentAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })

    expect(screen.getByText(/Referral/)).toBeTruthy()
    // The breakdown is not rendered until it is asked for.
    expect(screen.queryByText('Pipeline progress')).toBeNull()
    expect(screen.queryByText('Likelihood to hire')).toBeNull()
    expect(screen.queryByRole('button', { name: /Ask Claude/ })).toBeNull()
  })

  it('gives the full breakdown back on demand', async () => {
    const user = userEvent.setup()
    card({ leadSource: 'Client referral' })

    await user.click(screen.getByRole('button', { name: /Referral/ }))

    expect(screen.getByText('Pipeline progress')).toBeTruthy()
    expect(screen.getByText('Revenue signal')).toBeTruthy()
    expect(screen.getByText('Priority score')).toBeTruthy()
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

describe('optional missing context', () => {
  it('offers the unanswered questions, richest first, capped at three', async () => {
    // A bare lead is missing five; five asks on one card is nagging.
    actionableCard()

    const contextList = screen.getByText('Missing context').nextElementSibling as HTMLElement
    const asks = within(contextList).getAllByRole('button').map(button => button.textContent ?? '')
    expect(asks).toHaveLength(3)
    expect(asks[0]).toContain('Quote the fee')
    expect(asks.join(' ')).not.toContain('+15')
    // Estate and recency are also worth 15; urgency and source (10) fall off.
    expect(asks.join(' ')).not.toContain('Set the urgency')
  })

  it('sends a field gap to the field editor', async () => {
    const user = userEvent.setup()
    const { onFillField } = actionableCard()

    await user.click(screen.getByRole('button', { name: /Quote the fee/ }))

    expect(onFillField).toHaveBeenCalledWith('fee')
  })

  it('sends a gap no field can close to an intent instead', async () => {
    const user = userEvent.setup()
    // Silence in the record is not a blank field — nobody has spoken to them.
    const { onIntent, onFillField } = actionableCard({ feeQuoted: 4000, taxableEstate: 900000 })

    await user.click(screen.getByRole('button', { name: /Log a call or email/ }))

    expect(onIntent).toHaveBeenCalledWith('email')
    expect(onFillField).not.toHaveBeenCalled()
  })

  it('drops the gap the next-action banner is already showing', () => {
    // Two panels telling the reader to quote the same fee is one too many.
    actionableCard({}, { coveredByNextAction: 'fee' })

    expect(screen.queryByRole('button', { name: /Quote the fee/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Record the estate value/ })).toBeTruthy()
  })

  it('says nothing when the lead has answered everything it can', () => {
    actionableCard({
      feeQuoted: 4000,
      taxableEstate: 900_000,
      urgency: 'high',
      leadSource: 'Referral',
      lastTouchAt: new Date().toISOString(),
      readinessPercent: 80,
    })

    expect(screen.queryByText('Missing context')).toBeNull()
  })

  it('stays quiet on a card with no handlers, and on a closed lead', () => {
    // The card is also rendered read-only, and a lost lead's blank fee is not
    // a task anyone should be nudged towards.
    card()
    expect(screen.queryByText('Missing context')).toBeNull()
    cleanup()

    render(
      <LeadScoreCard
        leadId="lead-1"
        score={computeLeadScore(BASE)}
        leadStatus="lost"
        onFillField={vi.fn()}
      />,
    )
    expect(screen.queryByText('Missing context')).toBeNull()
  })
})


it('describes the score recency signal as record activity rather than client contact', async () => {
  const user = userEvent.setup()
  card({ lastTouchAt: new Date().toISOString() })
  expect(screen.getByText('Record activity today')).toBeTruthy()
  expect(screen.queryByText(/Last touch/)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Record activity today' }))
  expect(screen.getByText('Recent record activity')).toBeTruthy()
  expect(screen.queryByText('Recent contact')).toBeNull()
  expect(screen.getByText(/Priority includes internal record activity/)).toBeTruthy()
})
