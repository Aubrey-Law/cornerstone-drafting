// @vitest-environment jsdom

import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FirmDashboardView } from '@/app/admin/overview/FirmDashboardView'
import { buildFirmDashboard } from '@/lib/firm/dashboard'
import type { CrmDashboardSnapshot } from '@/lib/crm/dashboard'
import type { MatterDashboardSnapshot } from '@/lib/matters/dashboard'
import type { MatterCloseoutSummary } from '@/lib/matters/closeout'

const matters: MatterDashboardSnapshot = {
  open: { count: 2, newThisMonth: 1, newPriorMonth: 0, deltaPercent: null },
  executed: { count: 0, newThisMonth: 0, newPriorMonth: 0, deltaPercent: null },
  awaitingIntake: 0,
  needsAttention: 1,
  signingSoon: 0,
  stages: [{ key: 'drafting', label: 'Drafting', count: 2, percent: 100 }],
  practiceAreas: [{ key: 'estate', label: 'Estate planning', count: 2, percent: 100 }],
  recent: [],
}

const crm: CrmDashboardSnapshot = {
  people: { count: 4, newThisMonth: 1, newPriorMonth: 1, deltaPercent: 0 },
  activePipeline: { count: 3, newThisMonth: 1, newPriorMonth: 0, deltaPercent: null },
  converted: { count: 1, newThisMonth: 0, newPriorMonth: 0, deltaPercent: null },
  conversion: { percent: 25, converted: 1, total: 4 },
  leadSources: [{ key: 'referral', label: 'Referral', count: 3, percent: 75 }],
  pipeline: [{ key: 'new', label: 'New Inquiry', count: 3, percent: 100, isWon: false }],
  followUps: { overdue: 2, dueToday: 0, upcoming: 1 },
  recentPeople: [],
}

const closeout: MatterCloseoutSummary = { funding: null, fiduciaries: null, signing: null, blockers: null }

function view(
  tasks: Parameters<typeof buildFirmDashboard>[0]['tasks'],
  overrides: { matters?: MatterDashboardSnapshot; crm?: CrmDashboardSnapshot } = {},
) {
  const matterBook = overrides.matters ?? matters
  const leadBook = overrides.crm ?? crm
  const snapshot = buildFirmDashboard({
    tasks,
    matters: matterBook,
    aging: { active: 2, red: 0, amber: 0, green: 2, overdue: 0, snoozed: 0 },
    crm: leadBook,
  })
  return render(
    <FirmDashboardView
      snapshot={snapshot}
      matters={matterBook}
      crm={leadBook}
      recent={[]}
      closeout={closeout}
      mattersError={null}
      crmError="CRM data timed out"
      truncated
      peopleCeiling={500}
    />,
  )
}

describe('firm dashboard view', () => {
  it('links the pulse into the lists and says when a count is a sample', () => {
    view({ overdue: 1, today: 0, open: 4, mine: 1, team: 2, unassigned: 0 })

    const openMatters = screen.getByRole('link', { name: /Open matters/ })
    expect(openMatters.getAttribute('href')).toBe('/admin/matters/list')
    const followUps = screen.getAllByRole('link', { name: /Follow-ups overdue/ })
    expect(followUps.every(link => link.getAttribute('href') === '/admin/crm/activities')).toBe(true)
    const overdue = screen.getAllByRole('link', { name: /Overdue tasks/ })
    expect(overdue.every(link => link.getAttribute('href') === '/admin/tasks?group=due')).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('sample rather than a total')
    expect(screen.getByRole('alert').textContent).toContain('CRM data timed out')
    expect(screen.getByText('Drafting')).toBeTruthy()
    expect(screen.getByText('Referral')).toBeTruthy()
  })

  it('shows a clear queue without pretending missing tasks are zero', () => {
    view(null, {
      matters: { ...matters, needsAttention: 0 },
      crm: { ...crm, followUps: { overdue: 0, dueToday: 0, upcoming: 0 } },
    })
    expect(screen.getByText('Nothing in the firm queue needs a decision right now.')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('Task counts are unavailable. Please retry.')).toBeTruthy()
  })
})
