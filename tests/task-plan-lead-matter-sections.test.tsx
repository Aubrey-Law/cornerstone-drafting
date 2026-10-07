// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

import { TaskPlanView } from '@/components/tasks/TaskPlanView'
import { toPlanTask } from '@/lib/slaTasks/plan'
import type { TaskRow } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

/**
 * A lead and the matter it becomes run separate task lists. The plan shows
 * them under their own headings, lead first, rather than as one checklist.
 */

const MATTER_ID = '11111111-2222-3333-4444-555555555555'

function task(overrides: Partial<TaskRow>) {
  return toPlanTask(taskFixture({ matter_id: MATTER_ID, source: 'sla', ...overrides }))
}

function renderPlan(tasks: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tasks, progress: null, anchors: null, matter: { id: MATTER_ID, name: 'Whitfield' } }),
    }),
  )
  return render(<TaskPlanView matterId={MATTER_ID} enabled />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the plan splits lead and matter tasks', () => {
  it('files each task under its own list, lead first', async () => {
    renderPlan([
      task({ id: 'a', phase: 'new_lead', title: 'Hold discovery call', sort_order: 0 }),
      task({ id: 'b', phase: 'engagement_sent', title: 'Client signs engagement agreement', sort_order: 1 }),
      task({ id: 'c', phase: 'design', title: 'Client approves design', sort_order: 2 }),
    ])

    const lead = await screen.findByRole('region', { name: 'Lead tasks' })
    const matter = screen.getByRole('region', { name: 'Matter tasks' })
    expect(within(lead).getByText('Client signs engagement agreement')).toBeTruthy()
    expect(within(lead).queryByText('Client approves design')).toBeNull()
    expect(within(matter).getByText('Client approves design')).toBeTruthy()
    expect(within(matter).queryByText('Hold discovery call')).toBeNull()

    const order = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)
    expect(order).toEqual(['Lead tasks', 'Matter tasks'])
  })

  it('shows only the lead list on a lead that has not signed', async () => {
    renderPlan([task({ id: 'a', phase: 'new_lead', title: 'Hold discovery call' })])
    await screen.findByRole('region', { name: 'Lead tasks' })
    expect(screen.queryByRole('region', { name: 'Matter tasks' })).toBeNull()
  })

  it('keeps hand-added work with no stage on the matter list', async () => {
    renderPlan([
      task({ id: 'a', phase: 'new_lead', title: 'Hold discovery call' }),
      task({ id: 'z', phase: null, source: 'manual', title: 'Call the bank' }),
    ])
    const matter = await screen.findByRole('region', { name: 'Matter tasks' })
    expect(within(matter).getByText('Call the bank')).toBeTruthy()
  })
})
