// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ResponsiveDetailRail,
} from '@/components/layout/ResponsiveDetailRail'
import { LeadTopActions } from '@/components/leads/LeadTopActions'
import { MatterDetailHeader } from '@/app/admin/matters/[id]/MatterDetailHeader'
import type { PipelineMatter } from '@/types/database'

const mediaState = vi.hoisted(() => ({ mobile: false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? mediaState.mobile : !mediaState.mobile,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  mediaState.mobile = false
  installMatchMedia()
})

afterEach(cleanup)

describe('responsive admin detail layout', () => {
  it('renders one desktop complementary rail without duplicating its content', () => {
    render(
      <ResponsiveDetailRail
        open
        onOpenChange={vi.fn()}
        label="Lead details"
      >
        <label htmlFor="client-name">Client name</label>
        <input id="client-name" />
      </ResponsiveDetailRail>,
    )

    expect(screen.getByRole('complementary', { name: 'Lead details' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByLabelText('Client name')).toHaveLength(1)
  })

  it('renders the same rail content in a named mobile sheet', () => {
    mediaState.mobile = true

    render(
      <ResponsiveDetailRail
        open
        onOpenChange={vi.fn()}
        label="Lead details"
      >
        <label htmlFor="client-name">Client name</label>
        <input id="client-name" />
      </ResponsiveDetailRail>,
    )

    expect(screen.queryByRole('complementary', { name: 'Lead details' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Lead details' })).toBeTruthy()
    expect(screen.getAllByLabelText('Client name')).toHaveLength(1)
  })

  it('puts lead actions in a named mobile overflow menu', async () => {
    const callbacks = {
      onDraft: vi.fn(),
      onConvert: vi.fn(),
      onClearSnooze: vi.fn(),
      onStatusChange: vi.fn(),
      onSendSchedulingLink: vi.fn(),
      onBookForClient: vi.fn(),
      onCall: vi.fn(),
      onEmail: vi.fn(),
      onText: vi.fn(),
      onIntake: vi.fn(),
      onToggleRail: vi.fn(),
    }

    render(
      <LeadTopActions
        busy={false}
        status="lead"
        hasActiveAgreement={false}
        snoozed={false}
        matterId={null}
        railOpen={false}
        hasEmail
        hasPhone
        {...callbacks}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'More lead actions' }))

    expect(screen.getByRole('menuitem', { name: 'Call' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Email' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Text' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Open details' })).toBeTruthy()
  })

  it('puts matter actions in a named mobile overflow menu', async () => {
    const matter = {
      matter_id: 'matter-1',
      matter_name: 'Jane Client',
      client_name: 'Jane Client',
      stage: 'intake',
      client_phone: null,
    } as unknown as PipelineMatter

    render(
      <MatterDetailHeader
        matter={matter}
        matterNumber="1024"
        intakeCompleted={false}
        intakeId={null}
        unlocking={false}
        factsRailOpen={false}
        onToggleFactsRail={vi.fn()}
        onEmail={vi.fn()}
        onOpenIntake={vi.fn()}
        onImportIntake={vi.fn()}
        onUnlockIntake={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Matter actions' }))

    expect(screen.getByRole('menuitem', { name: 'Create intake' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open drafting' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open facts' })).toBeTruthy()
  })
})
