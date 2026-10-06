// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MatterReadinessDial } from '@/app/admin/matters/[id]/MatterReadinessDial'

afterEach(cleanup)

const item = (key: string, label: string, resolved: boolean) => ({ key, label, resolved })

it('says the listed milestones are still needed, not done', () => {
  render(<MatterReadinessDial items={[
    item('intake', 'Intake complete', false),
    item('sheet', 'Design sheet seeded', false),
    item('uploads', 'Uploads reviewed', false),
    item('portal', 'Client messages read', false),
    item('engagement', 'Engagement signed', true),
  ]} />)
  const line = screen.getByText(/^Still needed:/)
  expect(line.textContent).toBe('Still needed: Intake complete · Design sheet seeded · Uploads reviewed · +1 more')
  // Two lines rather than one truncated line, so the count is not cut off.
  expect(line.className).toContain('line-clamp-2')
  expect(screen.getByRole('img', { name: 'Drafting readiness 20 percent' })).toBeTruthy()
})

it('reads plainly when nothing blocks drafting', () => {
  render(<MatterReadinessDial items={[item('intake', 'Intake complete', true)]} />)
  expect(screen.getByText('No open blockers')).toBeTruthy()
})
