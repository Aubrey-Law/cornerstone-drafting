// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ResponsiveDetailRail,
} from '@/components/layout/ResponsiveDetailRail'
import { AdminRailVisibilityContext } from '@/components/rail/AdminRailVisibilityContext'
import { LeadTopActions } from '@/components/leads/LeadTopActions'
import { MatterWorkspaceHeader } from '@/components/matter/MatterWorkspaceHeader'
import type { PipelineMatter } from '@/types/database'

const mediaState = vi.hoisted(() => ({ mobile: false, tablet: false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)'
        ? mediaState.mobile
        : query === '(max-width: 1023px)'
          ? mediaState.tablet || mediaState.mobile
          : false,
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
  mediaState.tablet = false
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

  it('collapses a right-side matter rail into a sheet below lg', () => {
    mediaState.tablet = true

    render(
      <ResponsiveDetailRail
        open
        onOpenChange={vi.fn()}
        label="Matter details"
        side="right"
        collapseBelow="lg"
      >
        <p>Matter facts</p>
      </ResponsiveDetailRail>,
    )

    expect(screen.queryByRole('complementary', { name: 'Matter details' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Matter details' })).toBeTruthy()
    expect(screen.getAllByText('Matter facts')).toHaveLength(1)
  })

  it('keeps the matter workspace usable when the admin rail is already visible', () => {
    render(
      <AdminRailVisibilityContext.Provider value>
        <ResponsiveDetailRail
          open
          onOpenChange={vi.fn()}
          label="Matter details"
          side="right"
          collapseBelow="lg"
          collapseWithAdminRail
        >
          <p>Matter facts</p>
        </ResponsiveDetailRail>
      </AdminRailVisibilityContext.Provider>,
    )

    expect(screen.queryByRole('complementary', { name: 'Matter details' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Matter details' })).toBeTruthy()
    expect(screen.getAllByText('Matter facts')).toHaveLength(1)
  })

  it('opens the mobile sheet focused on itself, not on its first field', async () => {
    mediaState.mobile = true
    render(
      <ResponsiveDetailRail open onOpenChange={vi.fn()} label="Matter facts">
        <label htmlFor="client-name">Client name</label>
        <input id="client-name" defaultValue="Jordan Client" />
      </ResponsiveDetailRail>,
    )
    const sheet = await screen.findByRole('dialog', { name: 'Matter facts' })
    // Focusing the name field selected it for editing and raised the keyboard.
    await vi.waitFor(() => expect(document.activeElement).toBe(sheet))
    expect(document.activeElement).not.toBe(screen.getByLabelText('Client name'))
  })

  it('puts lead actions in the named Actions menu, as on the matter page', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }))

    expect(screen.getByRole('menuitem', { name: 'Call client' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Email client' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /^Text/ })).toBeNull()
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
      <MatterWorkspaceHeader
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

    expect(screen.getByRole('menuitem', { name: 'Review / update intake' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open drafting' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Open details' })).toBeTruthy()
  })
})
