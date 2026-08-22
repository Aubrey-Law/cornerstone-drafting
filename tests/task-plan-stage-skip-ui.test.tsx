// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
 * The stage card's "not applicable".
 *
 * The control has to be honest about what it will do before it is clicked: it
 * disappears on a finished stage, because there is no such thing as work that
 * was done and also did not apply, and it flips to a restore only once nothing
 * in the stage is outstanding.
 */

const MATTER_ID = '11111111-2222-3333-4444-555555555555'

function task(overrides: Partial<TaskRow>) {
  // Through the real projection — the route serialises `PlanTask`, so a bare
  // `TaskRow` would carry `title` where the row reads `name`.
  return toPlanTask(taskFixture({ matter_id: MATTER_ID, source: 'sla', phase: 'design', ...overrides }))
}

const OPEN = task({ id: 't-open', title: 'Hold the design meeting' })
const DONE = task({ id: 't-done', title: 'Send the design agenda', status: 'done' })
const SKIPPED = task({
  id: 't-skipped',
  title: 'Second design meeting',
  status: 'archived',
  skipped_at: '2026-04-01T12:00:00.000Z',
})
const CLOSED_OUT = task({
  id: 't-closed',
  title: 'Draft the trust',
  status: 'archived',
  skipped_at: '2026-04-01T12:00:00.000Z',
  closeout_reason: 'lead_lost',
})

let fetchMock: ReturnType<typeof vi.fn>

function renderPlan(tasks: unknown[]) {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ tasks, progress: null, anchors: null, matter: { id: MATTER_ID, name: 'Whitfield' } }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return render(<TaskPlanView matterId={MATTER_ID} enabled />)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the stage card offers a stage-level skip', () => {
  it('offers it while the stage still has work outstanding', async () => {
    renderPlan([OPEN, DONE])

    const button = await screen.findByRole('button', { name: 'Not applicable' })
    // The count in the tooltip is the promise the click has to keep: one open
    // task here, not the two the stage holds.
    expect(button.getAttribute('title')).toContain('1 task still open')
  })

  it('sends one request for the whole stage', async () => {
    renderPlan([OPEN, DONE])
    fireEvent.click(await screen.findByRole('button', { name: 'Not applicable' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/phase'))
      expect(call).toBeTruthy()
      expect(String(call![0])).toBe(`/api/matters/${MATTER_ID}/tasks/phase`)
      expect(JSON.parse(call![1].body)).toEqual({ phase: 'design', status: 'skipped' })
    })
  })

  it('says nothing on a stage that is finished', async () => {
    renderPlan([DONE])

    await screen.findByText('Send the design agenda')
    expect(screen.queryByRole('button', { name: 'Not applicable' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore stage' })).toBeNull()
  })

  it('offers the restore once nothing in the stage is outstanding', async () => {
    renderPlan([DONE, SKIPPED])

    const button = await screen.findByRole('button', { name: 'Restore stage' })
    expect(button.getAttribute('title')).toContain('1 skipped task')
  })

  it('keeps offering the skip while one task is still open beside a skipped one', async () => {
    renderPlan([OPEN, SKIPPED])

    await screen.findByRole('button', { name: 'Not applicable' })
    expect(screen.queryByRole('button', { name: 'Restore stage' })).toBeNull()
  })

  it('sends the restore as a reopen of the same stage', async () => {
    renderPlan([SKIPPED])
    fireEvent.click(await screen.findByRole('button', { name: 'Restore stage' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tasks/phase'))
      expect(JSON.parse(call![1].body)).toEqual({ phase: 'design', status: 'open' })
    })
  })

  it('offers nothing on a stage holding only closed-out rows', async () => {
    // Those came from the matter's status, not from a decision about the stage,
    // and the matter reopening is what brings them back.
    renderPlan([CLOSED_OUT])

    await screen.findByText('Draft the trust')
    expect(screen.queryByRole('button', { name: 'Restore stage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Not applicable' })).toBeNull()
  })
})
