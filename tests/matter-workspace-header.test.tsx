// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { MatterWorkspaceHeader } from '@/components/matter/MatterWorkspaceHeader'
import { ResponsiveDetailRail } from '@/components/layout/ResponsiveDetailRail'
import type { PipelineMatter } from '@/types/database'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
})
afterEach(cleanup)

const matter = {
  matter_id: 'm-1', client_name: 'Daniel Whitfield', matter_name: 'Whitfield', stage: 'design',
  client_email: 'dan@example.com', client_phone: '+16175550148', matter_created: '2026-09-22T12:00:00Z',
} as PipelineMatter

it('renders every Actions item in the handoff order', async () => {
  render(
    <MatterWorkspaceHeader
      matter={matter}
      matterNumber="2026-0142"
      intakeCompleted
      intakeId="intake-1"
      unlocking={false}
      factsRailOpen={false}
      onToggleFactsRail={vi.fn()}
      onEmail={vi.fn()}
      onOpenIntake={vi.fn()}
      onImportIntake={vi.fn()}
      onUnlockIntake={vi.fn()}
      onPushToLawmatics={vi.fn()}
      onPushToStatular={vi.fn()}
      onDelete={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: 'Show matter details' }).getAttribute('aria-pressed')).toBe('false')
  await userEvent.click(screen.getByRole('button', { name: 'Matter actions' }))
  const items = screen.getAllByRole('menuitem').map(item => item.textContent?.trim())
  expect(items).toEqual([
    'Call client',
    'Email client',
    'Review / update intake',
    'Import intake — paste text or upload Word',
    'Unlock intake for client editing',
    'Open drafting',
    'Open in Assistant',
    'Push to Lawmatics',
    'Push to Statular',
    'Open details',
    'Delete matter',
  ])
})

it('pushes the content aside at lg instead of overlaying it', () => {
  render(
    <div className="flex">
      <main>Tab content</main>
      <ResponsiveDetailRail open onOpenChange={vi.fn()} label="Matter details" side="right" collapseBelow="lg"
        desktopClassName="w-[340px] border-l border-border bg-card">
        <p>Panel body</p>
      </ResponsiveDetailRail>
    </div>,
  )
  const panel = screen.getByRole('complementary', { name: 'Matter details' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(panel.className).toContain('w-[340px]')
  expect(panel.className).not.toMatch(/\b(fixed|absolute)\b/)
  expect(panel.previousElementSibling?.textContent).toBe('Tab content')
})
