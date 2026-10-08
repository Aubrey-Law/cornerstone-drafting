// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MatterStageStrip, skippedStages } from '@/app/admin/matters/[id]/MatterStageStrip'

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
  it('offers work stages without intake and confirms before moving from the tracker', async () => {
    const onStageChange = renderStrip()
    expect(screen.queryByRole('button', { name: 'Intake' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Intake Review' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Revision' }))
    expect(onStageChange).not.toHaveBeenCalled()
    expect((screen.getByRole('combobox', { name: 'New stage' }) as HTMLSelectElement).value).toBe('revision')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm stage change' }))
    expect(onStageChange).toHaveBeenCalledWith('revision')
  })

  it('keeps the progress rail read-only and changes stage through an explicit confirmation', async () => {
    const user = userEvent.setup()
    const onStageChange = renderStrip()

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

describe('skipped stages', () => {
  const history = [
    { stage: 'new_lead', enteredAt: '2026-10-02T18:39:02Z' },
    { stage: 'intake', enteredAt: '2026-10-02T18:39:03Z' },
    { stage: 'drafting', enteredAt: '2026-10-02T18:39:04Z' },
  ]

  it('marks stages the matter jumped over as skipped, not done', () => {
    // intake -> drafting skipped Intake Review and Design; new_lead is a lead
    // stage, so the record starts at Intake.
    const skipped = skippedStages(history, 1)
    expect([...skipped].sort()).toEqual([])
  })

  it('says nothing about stages before the first recorded one, or with no history', () => {
    // The record starts at Drafting, still current: nothing before it is judged.
    expect(skippedStages([{ stage: 'drafting', enteredAt: '2026-10-02T00:00:00Z' }], 1).size).toBe(0)
    expect(skippedStages([], 5).size).toBe(0)
  })

  it('counts a stage entered on this visit as visited', () => {
    const skipped = skippedStages(
      [{ stage: 'drafting', enteredAt: '2026-10-02T00:00:00Z' }],
      5,
      ['client_review'],
    )
    expect(skipped.has('client_review')).toBe(false)
  })

  it('shows the skips in the roll-up and on visible pills', () => {
    render(
      <MatterStageStrip
        stage="drafts_approved"
        details={null}
        agingSummary={null}
        stageSaving={false}
        onStageChange={vi.fn()}
        history={[
          { stage: 'intake', enteredAt: '2026-10-01T00:00:00Z' },
          { stage: 'drafting', enteredAt: '2026-10-02T00:00:00Z' },
          { stage: 'client_review', enteredAt: '2026-10-03T00:00:00Z' },
          { stage: 'drafts_approved', enteredAt: '2026-10-04T00:00:00Z' },
        ]}
      />,
    )
    // Intake Review and Design were jumped over, and Revision never happened
    // (approved straight from review); the summary retains the skipped count.
    expect(screen.getByRole('button', { name: 'Revision (skipped)' }).getAttribute('title')).toBe('Skipped')
  })

  it('strikes through a visible pill for a stage that was skipped', () => {
    render(
      <MatterStageStrip
        stage="signing_complete"
        details={null}
        agingSummary={null}
        stageSaving={false}
        onStageChange={vi.fn()}
        history={[
          { stage: 'intake', enteredAt: '2026-10-01T00:00:00Z' },
          { stage: 'client_review', enteredAt: '2026-10-02T00:00:00Z' },
          { stage: 'drafts_approved', enteredAt: '2026-10-03T00:00:00Z' },
          { stage: 'signing_complete', enteredAt: '2026-10-04T00:00:00Z' },
        ]}
      />,
    )
    const scheduled = screen.getByRole('button', { name: 'Signing Scheduled (skipped)' })
    expect(scheduled.getAttribute('title')).toBe('Skipped')
    expect(screen.getByRole('button', { name: 'Drafts Approved' }).getAttribute('title')).not.toBe('Skipped')
  })
})
