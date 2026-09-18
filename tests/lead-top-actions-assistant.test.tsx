// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LeadTopActions } from '@/components/leads/LeadTopActions'

afterEach(cleanup)

function renderActions() {
  return render(
    <LeadTopActions
      busy={false}
      status="lead"
      hasActiveAgreement={false}
      snoozed={false}
      matterId={null}
      leadId="l-1"
      onDraft={vi.fn()}
      onConvert={vi.fn()}
      onClearSnooze={vi.fn()}
      onStatusChange={vi.fn()}
      onSendSchedulingLink={vi.fn()}
      onBookForClient={vi.fn()}
      onCall={vi.fn()}
      onEmail={vi.fn()}
      onText={vi.fn()}
      onIntake={vi.fn()}
      onToggleRail={vi.fn()}
      railOpen={false}
      hasEmail
      hasPhone
    />,
  )
}

describe('the lead page hands the lead to the Assistant', () => {
  it('offers an Assistant chat already pointed at this lead', async () => {
    const user = userEvent.setup()
    renderActions()

    await user.click(screen.getAllByRole('button', { name: /more actions/i })[0]!)

    const item = await screen.findByRole('menuitem', { name: /open in assistant/i })
    expect(item.getAttribute('href')).toBe('/admin/assistant?lead=l-1')
  })
})
