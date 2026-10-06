// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MatterProgressTimeline } from '@/app/admin/matters/[id]/MatterProgressTimeline'
import type { PipelineMatter } from '@/types/database'

afterEach(cleanup)

const matter = {
  matter_id: 'm1',
  stage: 'drafting',
  matter_created: '2026-10-03T01:30:00Z', // Oct 2, 9:30 PM in Boston
  intake_submitted_at: null,
} as unknown as PipelineMatter

function step(label: string) {
  return screen.getByText(label).closest('li')!
}

it('does not mark intake done when the matter moved past it without one', () => {
  render(<MatterProgressTimeline matter={matter} details={null} intakeCompletedAt={null} />)
  expect(step('Intake').textContent).toContain('Not received')
  expect(step('Intake').querySelector('.bg-primary')).toBeNull()
  // Opened is complete, and dated by the firm's day rather than UTC's.
  expect(step('Opened').querySelector('.bg-primary')).not.toBeNull()
  expect(step('Opened').textContent).toContain('10/2/2026')
})

it('marks intake done, with its date only, once it was received', () => {
  render(<MatterProgressTimeline matter={matter} details={null} intakeCompletedAt="2026-10-02T15:00:00Z" />)
  expect(step('Intake').querySelector('.bg-primary')).not.toBeNull()
  expect(step('Intake').textContent).toContain('10/2/2026')
  expect(step('Intake').textContent).not.toMatch(/PM|AM/)
})
