// @vitest-environment jsdom
import fs from 'node:fs'
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { LeadStageStepper } from '@/components/leads/LeadStageStepper'
import type { LeadListRow } from '@/lib/leads/viewTypes'

afterEach(cleanup)

const base = { lead_status: 'lead', intake_sent_at: null, intake_completed_at: null, status: null, engagement_sent_at: null, engagement_status: null } as unknown as LeadListRow

function current() {
  return within(screen.getByRole('list', { name: 'Lead progress' })).getAllByRole('listitem').find(item => item.getAttribute('aria-current') === 'step')?.textContent ?? null
}

it('walks the lead board stages, marking the current one', () => {
  const { rerender } = render(<LeadStageStepper lead={base} daysAsLead={3} lastContactDays={null} />)
  expect(within(screen.getByRole('list', { name: 'Lead progress' })).getAllByRole('listitem').map(item => item.textContent))
    .toEqual(['New', 'Intake sent', 'Intake complete', 'Engagement', 'Hired'])
  expect(current()).toBe('New')
  expect(screen.getByText('No client contact yet')).toBeTruthy()
  rerender(<LeadStageStepper lead={{ ...base, intake_sent_at: '2026-10-01' } as LeadListRow} daysAsLead={3} lastContactDays={2} />)
  expect(current()).toBe('Intake sent')
  expect(screen.getByText('Last contact 2d ago')).toBeTruthy()
  rerender(<LeadStageStepper lead={{ ...base, lead_status: 'hired' } as LeadListRow} daysAsLead={9} lastContactDays={0} />)
  expect(current()).toBe('Hired')
})

it('shows a closed lead as Lost with no current step', () => {
  render(<LeadStageStepper lead={{ ...base, lead_status: 'lost', intake_sent_at: '2026-10-01' } as LeadListRow} daysAsLead={12} lastContactDays={5} />)
  expect(current()).toBeNull()
  expect(screen.getAllByText('Lost').length).toBeGreaterThan(0)
})

it('builds both record headers on the shared workspace shell', () => {
  const lead = fs.readFileSync('app/admin/leads/[id]/LeadDetailClient.tsx', 'utf8')
  const matter = fs.readFileSync('components/matter/MatterWorkspaceHeader.tsx', 'utf8')
  for (const source of [lead, matter]) expect(source).toContain('<RecordWorkspaceHeader')
  // The lead's Details panel pushes content on desktop, like the matter page's.
  expect(lead).toContain('side="right"')
  expect(lead).toContain('collapseBelow="lg"')
  expect(lead).toContain('desktopClassName="w-[340px] border-l border-border bg-card"')
  expect(lead).not.toContain('LeadOverviewDetails')
})
