// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LeadTopActions } from '@/components/leads/LeadTopActions'

afterEach(cleanup)

function renderActions(props: { onPushToStatular?: () => void; pushingToStatular?: boolean }) {
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
      {...props}
    />,
  )
}

async function openMenu() {
  const user = userEvent.setup()
  await user.click(screen.getAllByRole('button', { name: /more actions/i })[0]!)
  return user
}

describe('Push to Statular on the lead page', () => {
  it('pushes when chosen from the actions menu', async () => {
    const onPushToStatular = vi.fn()
    renderActions({ onPushToStatular })
    const user = await openMenu()

    await user.click(await screen.findByRole('menuitem', { name: 'Push to Statular' }))

    expect(onPushToStatular).toHaveBeenCalledOnce()
  })

  it('disables the item while a push is in flight', async () => {
    renderActions({ onPushToStatular: vi.fn(), pushingToStatular: true })
    await openMenu()

    const item = await screen.findByRole('menuitem', { name: 'Pushing to Statular…' })
    expect(item.getAttribute('aria-disabled')).toBe('true')
  })

  it('is hidden when no handler is wired', async () => {
    renderActions({})
    await openMenu()

    await screen.findByRole('menuitem', { name: /send scheduling link/i })
    expect(screen.queryByRole('menuitem', { name: /statular/i })).toBeNull()
  })
})
