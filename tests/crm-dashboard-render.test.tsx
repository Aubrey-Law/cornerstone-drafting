// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { buildCrmDashboard } from '@/lib/crm/dashboard'
import type { CrmPeopleRow, CrmStageRow } from '@/lib/queries/cornerstoneCrm'
import type { TaskRow } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

import { CrmStatCards } from '@/app/admin/crm/CrmStatCards'
import { CrmPipelineCard } from '@/app/admin/crm/CrmPipelineCard'
import { CrmTasksCard } from '@/app/admin/crm/CrmTasksCard'
import { LeadSourcesCard } from '@/app/admin/crm/LeadSourcesCard'
import { RecentPeopleTable } from '@/app/admin/crm/RecentPeopleTable'

const NOW = new Date('2026-08-06T16:00:00.000Z')

const stages: CrmStageRow[] = [
  { id: 'stage-new', name: 'New Inquiry', slug: 'new', sort_order: 1, is_active: true, is_closed: false, is_won: false },
  { id: 'stage-won', name: 'Hired', slug: 'hired', sort_order: 2, is_active: true, is_closed: true, is_won: true },
]

function person(overrides: Partial<CrmPeopleRow> & { id: string }): CrmPeopleRow {
  return {
    sourceSystem: 'cornerstone',
    personKind: 'primary',
    name: 'Person',
    email: 'person@example.com',
    phone: null,
    mobilePhone: null,
    company: null,
    jobTitle: null,
    city: null,
    state: null,
    country: null,
    leadSource: 'referral',
    referralSource: null,
    lifecycleStatus: 'qualified',
    ownerUserId: null,
    assignedToUserId: null,
    nextFollowUpAt: null,
    lastEngagementAt: null,
    campaignOptOut: null,
    stageId: 'stage-new',
    stageName: 'New Inquiry',
    stageSlug: 'new',
    stageEnteredAt: null,
    sourceRecordId: null,
    sourceRecordHref: null,
    sourceRecordLabel: null,
    createdAt: '2026-08-02T12:00:00.000Z',
    updatedAt: '2026-08-02T12:00:00.000Z',
    ...overrides,
  }
}

const snapshot = buildCrmDashboard({
  now: NOW,
  stages,
  people: [
    person({ id: 'p1', name: 'Chen, Marcus' }),
    person({ id: 'p2', name: 'Okafor, Ada', stageId: 'stage-won', lifecycleStatus: 'converted' }),
    person({ id: 'p3', name: 'Park, Sun', leadSource: null, createdAt: '2026-07-02T12:00:00.000Z' }),
  ],
})

const task: TaskRow = taskFixture({
  id: 'task-1',
  title: 'Follow up with Chen',
  description: 'Send the engagement letter',
  status: 'open',
  priority: 'high',
  source: 'manual',
  task_type: 'single',
  checklist: [],
  matter_id: null,
  lead_id: null,
  stage_key: null,
  stage_entered_at: null,
  batch_tag: null,
  soft_due_at: null,
  hard_due_at: null,
  due_at: '2026-08-06T20:00:00.000Z',
  assignee_id: null,
  estimate_minutes: null,
  remind_at: null,
  recurrence: null,
  template_id: null,
  document_id: null,
  completed_at: null,
  completed_by: null,
  created_by: null,
  created_at: '2026-08-01T12:00:00.000Z',
  updated_at: '2026-08-01T12:00:00.000Z',
})

describe('crm dashboard cards', () => {
  afterEach(cleanup)

  it('shows the conversion ring and the three headline totals', () => {
    render(<CrmStatCards snapshot={snapshot} />)

    // 1 of 3 converted.
    expect(screen.getByText('33%')).toBeTruthy()
    expect(screen.getByText('Total people')).toBeTruthy()
    expect(screen.getByText('Active pipeline')).toBeTruthy()
    expect(screen.getByText('Converted')).toBeTruthy()
  })

  it('renders one donut legend row per lead source', () => {
    render(<LeadSourcesCard sources={snapshot.leadSources} />)

    expect(screen.getByText('Referral')).toBeTruthy()
    expect(screen.getByText('Unattributed')).toBeTruthy()
    // Centre of the donut carries the whole directory.
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('lists pipeline stages in configured order with their share', () => {
    render(<CrmPipelineCard stages={snapshot.pipeline} />)

    const labels = screen.getAllByText(/New Inquiry|Hired/).map(node => node.textContent)
    expect(labels).toEqual(['New Inquiry', 'Hired'])
    expect(screen.getByText('67%')).toBeTruthy()
    expect(screen.getByText(/won/)).toBeTruthy()
  })

  it('renders an open task with its priority and falls back when empty', () => {
    const { unmount } = render(<CrmTasksCard tasks={[task]} />)
    expect(screen.getByText('Follow up with Chen')).toBeTruthy()
    expect(screen.getByText('High priority')).toBeTruthy()
    unmount()

    render(<CrmTasksCard tasks={[]} />)
    expect(screen.getByText('Nothing open right now.')).toBeTruthy()
  })

  it('tables the newest people with lifecycle and source', () => {
    render(<RecentPeopleTable people={snapshot.recentPeople} />)

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Chen, Marcus')).toBeTruthy()
    expect(table.getAllByText('Qualified').length).toBe(2)
    expect(table.getByText('Converted')).toBeTruthy()
  })
})
