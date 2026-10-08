// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'


vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { MatterDetailHeader } from '@/app/admin/matters/[id]/MatterDetailHeader'
import type { PipelineMatter } from '@/types/database'

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'm-1',
    client_name: 'Whitfield, Margaret',
    matter_name: 'Whitfield Trust',
    stage: 'intake',
    client_email: 'margaret@example.com',
    client_phone: '+16175550101',
    ...overrides,
  } as PipelineMatter
}

function renderHeader(
  over: Partial<PipelineMatter>,
  handlers: { onEmail: () => void },
) {
  return render(
    <MatterDetailHeader
      matter={matter(over)}
      matterNumber="2026-001"
      intakeCompleted={false}
      intakeId={null}
      unlocking={false}
      factsRailOpen={false}
      onToggleFactsRail={vi.fn()}
      onOpenIntake={vi.fn()}
      onImportIntake={vi.fn()}
      onUnlockIntake={vi.fn()}
      onDelete={vi.fn()}
      onEmail={handlers.onEmail}
    />,
  )
}

afterEach(cleanup)

describe('MatterDetailHeader communication actions', () => {
  it('composes identity, lifecycle, and workspace navigation in one header', () => {
    render(
      <MatterDetailHeader
        matter={matter({
          practice_area: 'EP',
          opened_at: '2026-10-01T12:00:00.000Z',
        })}
        matterNumber="2026-001"
        planLabel="Trust plan"
        matterTypeLabel="Couple"
        intakeCompleted={false}
        intakeId={null}
        unlocking={false}
        factsRailOpen={false}
        onToggleFactsRail={vi.fn()}
        onOpenIntake={vi.fn()}
        onImportIntake={vi.fn()}
        onUnlockIntake={vi.fn()}
        onDelete={vi.fn()}
        onEmail={vi.fn()}
        stage={<div aria-label="Matter stage">Stage controls</div>}
        navigation={<nav aria-label="Matter workspace">Workspace tabs</nav>}
      />,
    )

    const header = screen.getByRole('banner')
    expect(within(header).getByLabelText('Matter stage')).toBeTruthy()
    expect(within(header).getByRole('navigation', { name: 'Matter workspace' })).toBeTruthy()
    expect(within(header).getByText('Estate Planning')).toBeTruthy()
    expect(within(header).getByText('Trust plan')).toBeTruthy()
    expect(within(header).getByText('Couple')).toBeTruthy()
    expect(within(header).queryByText(/Opened/)).toBeNull()
  })

  it('keeps lifecycle status out of the identity and action header', () => {
    renderHeader({}, { onEmail: vi.fn() })

    expect(screen.queryByLabelText('Matter stage')).toBeNull()
    expect(screen.queryByText(/day \d+/i)).toBeNull()
  })

  it('keeps email and removes text controls', async () => {
    const user = userEvent.setup()
    const onEmail = vi.fn()
    const onText = vi.fn()
    renderHeader({}, { onEmail })

    await user.click(screen.getByRole('button', { name: 'Matter actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Email client' }))
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull()

    expect(onEmail).toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })

  it('disables Email without an address', async () => {
    renderHeader(
      { client_email: '', client_phone: '' },
      { onEmail: vi.fn() },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Matter actions' }))
    expect(screen.getByRole('menuitem', { name: 'Email client' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull()
  })
})

describe('MatterDetailHeader hands the matter to the Assistant', () => {
  it('links to an Assistant chat already pointed at this matter', async () => {
    renderHeader({}, { onEmail: vi.fn() })

    await userEvent.click(screen.getByRole('button', { name: 'Matter actions' }))
    const link = screen.getByRole('menuitem', { name: /open in assistant/i })
    expect(link.getAttribute('href')).toBe('/admin/assistant?matter=m-1')
  })
})
