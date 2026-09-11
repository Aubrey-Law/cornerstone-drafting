// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
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
  handlers: { onEmail: () => void; onText: () => void },
) {
  return render(
    <MatterDetailHeader
      matter={matter(over)}
      matterNumber="2026-001"
      agingSummary={null}
      intakeCompleted={false}
      intakeId={null}
      unlocking={false}
      showHealthBadge={false}
      factsRailOpen={false}
      onToggleFactsRail={vi.fn()}
      onOpenIntake={vi.fn()}
      onImportIntake={vi.fn()}
      onUnlockIntake={vi.fn()}
      onDelete={vi.fn()}
      onEmail={handlers.onEmail}
      onText={handlers.onText}
    />,
  )
}

afterEach(cleanup)

describe('MatterDetailHeader communication actions', () => {
  it('keeps email and removes text controls', async () => {
    const user = userEvent.setup()
    const onEmail = vi.fn()
    const onText = vi.fn()
    renderHeader({}, { onEmail, onText })

    await user.click(screen.getAllByRole('button', { name: 'Email' })[0])
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull()

    expect(onEmail).toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })

  it('disables Email without an address', () => {
    renderHeader(
      { client_email: '', client_phone: '' },
      { onEmail: vi.fn(), onText: vi.fn() },
    )

    expect((screen.getAllByRole('button', { name: 'Email' })[0] as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Text' })).toBeNull()
  })
})
