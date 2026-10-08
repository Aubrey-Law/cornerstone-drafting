// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/components/matter/MatterSwitcher', () => ({ MatterSwitcher: ({ label }: { label: string }) => <span>{label}</span> }))
import { MatterWorkspaceHeader } from '@/components/matter/MatterWorkspaceHeader'
import type { PipelineMatter } from '@/types/database'

afterEach(cleanup)

const matter = { matter_id: 'm1', client_name: 'Jordan Client', client_email: 'c@example.test', client_phone: null } as unknown as PipelineMatter

function renderHeader() {
  return render(
    <MatterWorkspaceHeader
      matter={matter} matterNumber="2026-EP-1" intakeCompleted={false} intakeId={null} unlocking={false}
      factsRailOpen={false} onToggleFactsRail={vi.fn()} onEmail={vi.fn()} onOpenIntake={vi.fn()}
      onImportIntake={vi.fn()} onUnlockIntake={vi.fn()} onDelete={vi.fn()}
    />,
  )
}

it('keeps matter identity visible with one actions menu at every width', () => {
  renderHeader()
  expect(screen.getByRole('heading', { name: 'Jordan Client' })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Matter actions' })).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Show matter details' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Intake actions' })).toBeNull()
})

it('offers everything from the compact menu, Open in Assistant included', async () => {
  renderHeader()
  await userEvent.click(screen.getByRole('button', { name: 'Matter actions' }))
  expect(screen.getByRole('menuitem', { name: 'Open in Assistant' }).getAttribute('href')).toBe('/admin/assistant?matter=m1')
  expect(screen.getByRole('menuitem', { name: 'Open drafting' })).toBeTruthy()
})
