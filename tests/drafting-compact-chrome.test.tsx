// @vitest-environment jsdom

import fs from 'node:fs'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { MatterStageStrip } from '@/app/admin/matters/[id]/MatterStageStrip'
import { MatterWorkspaceHeader } from '@/components/matter/MatterWorkspaceHeader'
import type { PipelineMatter } from '@/types/database'

afterEach(cleanup)

it('shows the stage as one chip that opens the change-stage dialog', async () => {
  const onStageChange = vi.fn()
  render(<MatterStageStrip compact stage="client_review" details={null} agingSummary={{ daysInStage: 1 } as never} stageSaving={false} onStageChange={onStageChange} />)
  expect(screen.queryByRole('list', { name: 'Matter progress' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Stage: Client Review · 1 business day in stage. Change stage' }))
  expect(screen.getByRole('combobox', { name: 'New stage' })).toBeTruthy()
})

it('collapses the header to the name, actions and tabs', () => {
  const matter = { matter_id: 'm-1', client_name: 'Daniel Whitfield', practice_area: 'EP', stage: 'design', matter_created: '2026-09-22T12:00:00Z' } as PipelineMatter
  const props = {
    matter, matterNumber: '2026-0142', intakeCompleted: false, intakeId: null, unlocking: false, factsRailOpen: false,
    onToggleFactsRail: vi.fn(), onEmail: vi.fn(), onOpenIntake: vi.fn(), onImportIntake: vi.fn(), onUnlockIntake: vi.fn(), onDelete: vi.fn(),
    stage: <div>Stage row</div>, meta: <span>Stage chip</span>, navigation: <nav aria-label="Matter workspace">Tabs</nav>,
  }
  const { rerender } = render(<MatterWorkspaceHeader {...props} />)
  expect(screen.getByText('Stage chip')).toBeTruthy()
  expect(screen.getByText('Stage row')).toBeTruthy()
  rerender(<MatterWorkspaceHeader {...props} collapsed />)
  expect(screen.queryByText('Stage chip')).toBeNull()
  expect(screen.queryByText('Stage row')).toBeNull()
  expect(screen.queryByText(/#2026-0142/)).toBeNull()
  expect(screen.getByRole('navigation', { name: 'Matter workspace' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Matter actions' })).toBeTruthy()
})

it('gives drafting one bar, a focus mode and a header that folds while the sheet scrolls', () => {
  const page = fs.readFileSync('app/admin/drafting/[matterId]/page.tsx', 'utf8')
  const workspace = fs.readFileSync('app/admin/drafting/[matterId]/DraftingWorkspace.tsx', 'utf8')
  const frame = fs.readFileSync('app/admin/matters/[id]/MatterWorkspaceFrame.tsx', 'utf8')
  expect(page).toContain('embeddedInWorkspace')
  // The embedded bar drops the breadcrumb and Back to matter; the standalone header keeps them.
  const embedded = workspace.slice(workspace.indexOf('{embeddedInWorkspace ? ('), workspace.indexOf(') : <>'))
  expect(embedded).not.toContain('Back to matter')
  expect(embedded).not.toContain('aria-label="Breadcrumb"')
  expect(embedded).toContain('{stepper()}')
  expect(workspace).toContain('Back to matter')
  // `?focus=` is the design sheet's; focus mode uses `?mode=focus`.
  expect(frame).toContain("searchParams.get('mode') === 'focus'")
  const collapse = fs.readFileSync('app/admin/matters/[id]/useCollapseOnScroll.ts', 'utf8')
  const client = fs.readFileSync('app/admin/matters/[id]/MatterDetailClient.tsx', 'utf8')
  expect(collapse).toContain("addEventListener('scroll', onScroll, { capture: true, passive: true })")
  expect(frame).toContain('useCollapseOnScroll<HTMLDivElement>()')
  // The matter page folds its header only on a phone.
  expect(client).toContain("useCollapseOnScroll<HTMLDivElement>('(max-width: 767px)')")
  expect(client).toContain('collapsed={headerCollapsed}')
  expect(frame).toContain('collapsed={collapsed}')
  expect(frame).toContain('<MatterStageStrip\n            compact')
})
