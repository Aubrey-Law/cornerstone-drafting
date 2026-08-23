// @vitest-environment jsdom

import React from 'react'
import fs from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MatterPipelineInsights,
  isOpenMatter,
  matterNeedsAttention,
  signingSoon,
} from '@/components/matter/MatterPipelineInsights'
import type { MatterListRow } from '@/lib/queries/matters'

afterEach(cleanup)

const NOW = Date.parse('2026-07-15T12:00:00.000Z')

function matter(overrides: Partial<MatterListRow> = {}): MatterListRow {
  return {
    matter_id: 'm-1',
    matter_number: 'EP-1001',
    matter_name: 'Chen Trust',
    client_name: 'Margaret Chen',
    stage: 'drafting',
    status: 'active',
    matter_created: '2026-07-14T12:00:00.000Z',
    intake_submitted_at: '2026-07-14T12:00:00.000Z',
    ...overrides,
  } as MatterListRow
}

describe('matter insight predicates', () => {
  it('counts everything that has not reached a closed stage as open', () => {
    expect(isOpenMatter(matter({ stage: 'drafting' }))).toBe(true)
    expect(isOpenMatter(matter({ stage: 'closed' }))).toBe(false)
  })

  it('flags a matter that has gone quiet for a fortnight', () => {
    expect(matterNeedsAttention(matter({ matter_created: '2026-07-14T12:00:00.000Z', intake_submitted_at: null }), NOW)).toBe(false)
    expect(matterNeedsAttention(matter({ matter_created: '2026-06-01T12:00:00.000Z', intake_submitted_at: null }), NOW)).toBe(true)
  })

  it('flags uploads nobody has reviewed however recent the matter is', () => {
    expect(matterNeedsAttention(matter({ unreviewed_upload_count: 2 }), NOW)).toBe(true)
  })

  it('counts a signing inside the window and not one already executed', () => {
    expect(signingSoon(matter({ signing_date: '2026-07-30' }), NOW)).toBe(true)
    expect(signingSoon(matter({ signing_date: '2026-09-30' }), NOW)).toBe(false)
    expect(signingSoon(matter({ signing_date: '2026-05-30' }), NOW)).toBe(false)
    expect(
      signingSoon(matter({ signing_date: '2026-07-30', documents_executed_at: '2026-07-30T00:00:00.000Z' }), NOW),
    ).toBe(false)
  })
})

describe('MatterPipelineInsights', () => {
  it('summarizes the matters it is given and reports the filter a card selects', async () => {
    const user = userEvent.setup()
    const onToggleFilter = vi.fn()
    render(
      <MatterPipelineInsights
        matters={[
          matter({ matter_id: 'a', unreviewed_upload_count: 3 }),
          matter({ matter_id: 'b', intake_submitted_at: null, matter_created: '2026-07-14T12:00:00.000Z' }),
          matter({ matter_id: 'c', stage: 'closed' }),
        ]}
        onToggleFilter={onToggleFilter}
      />,
    )

    // Two open matters — the closed one is out of every count.
    expect(screen.getByText('Open matters').closest('button')?.textContent).toContain('2')
    expect(screen.getByText('Uploads to review').closest('div')?.parentElement?.textContent).toContain('3')
    expect(screen.getByText('1 awaiting intake')).toBeTruthy()

    await user.click(screen.getByText('Needs attention'))
    expect(onToggleFilter).toHaveBeenCalledWith('attention')
  })

  it('marks the active card as pressed', () => {
    render(<MatterPipelineInsights matters={[matter()]} activeFilter="signing" onToggleFilter={vi.fn()} />)
    expect(screen.getByText('Signing soon').closest('button')?.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the two overviews stay on their own side of the lifecycle', () => {
  it('reads matters from the hired pipeline view and leads from lead-state intake rows', () => {
    // Matters: the pipeline view, archived rows excluded.
    const mattersLoader = fs.readFileSync('lib/queries/matters.ts', 'utf8')
    expect(mattersLoader).toContain("from('v_matter_pipeline')")
    expect(mattersLoader).toContain(".neq('status', 'archived')")

    // Leads: intake rows still in a lead state — a hired one leaves for its
    // matter. Stated in v_lead_list since the list moved into the database.
    const dir = 'supabase/migrations'
    const leadListView = fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort().reverse()
      .map(name => fs.readFileSync(`${dir}/${name}`, 'utf8'))
      .find(sql => sql.includes('create or replace view public.v_lead_list'))
    expect(leadListView).toMatch(/in \('lead', 'lost', 'declined'\)/)
    expect(leadListView).toContain('coalesce(m.relationship_status, ci.lead_status) as lead_status')

    // Each list feeds its own insight strip from that list and nothing else.
    const mattersClient = fs.readFileSync('app/admin/matters/MattersClient.tsx', 'utf8')
    expect(mattersClient).toContain('<MatterPipelineInsights')
    expect(mattersClient).toContain('matters={matters}')
    const leadsClient = fs.readFileSync('app/admin/leads/LeadsClient.tsx', 'utf8')
    expect(leadsClient).toContain('<LeadPipelineInsights')
    expect(leadsClient).not.toContain('MatterPipelineInsights')
  })
})
