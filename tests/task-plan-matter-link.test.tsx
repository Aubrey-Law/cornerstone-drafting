// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
import { taskFixture } from './fixtures/task'

/**
 * A plan is reachable from a lead as well as from the matter that owns it — a
 * lead's plan hangs off the `matters` row it owns. From there nothing else on a
 * row says whose plan it is, so each row names its matter and links to it.
 */

const MATTER_ID = '11111111-2222-3333-4444-555555555555'

function planResponse(overrides: Record<string, unknown> = {}) {
  return {
    // Through the real projection: the route serialises `PlanTask`, so a bare
    // `TaskRow` here would have `title` where the row reads `name`, and the
    // test would pass against markup no user ever sees.
    tasks: [
      toPlanTask(
        taskFixture({
          id: 'task-a',
          matter_id: MATTER_ID,
          source: 'sla',
          phase: 'drafting',
          title: 'Draft full document package',
          hard_due_at: '2026-03-08T12:00:00.000Z',
          due_at: '2026-03-08T12:00:00.000Z',
        }),
      ),
    ],
    progress: null,
    anchors: null,
    matter: { id: MATTER_ID, name: 'Whitfield, Margaret' },
    ...overrides,
  }
}

function renderPlan(body: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response)
  return render(<TaskPlanView matterId={MATTER_ID} enabled />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a plan row says which matter it belongs to', () => {
  it('names the matter and links to its record', async () => {
    renderPlan(planResponse())

    const link = await screen.findByRole('link', { name: /Whitfield, Margaret/ })
    // The matter record, not this view: from the matter's own Tasks tab a link
    // back to the same tab would go nowhere.
    expect(link.getAttribute('href')).toBe(`/admin/matters/${MATTER_ID}`)
  })

  it('still renders a link when the matter has no name on it', async () => {
    renderPlan(planResponse({ matter: { id: MATTER_ID, name: null } }))

    const link = await screen.findByRole('link', { name: /Matter/ })
    expect(link.getAttribute('href')).toBe(`/admin/matters/${MATTER_ID}`)
  })

  it('omits the indicator when the caller turns it off', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => planResponse(),
    } as Response)
    render(<TaskPlanView matterId={MATTER_ID} enabled showMatter={false} />)

    await screen.findByText('Draft full document package')
    expect(screen.queryByRole('link', { name: /Whitfield, Margaret/ })).toBeNull()
  })

  it('survives a response that carries no matter block', async () => {
    // Older clients and any cached response predate the field; the row should
    // degrade to an unnamed link rather than crash the whole plan.
    renderPlan(planResponse({ matter: undefined }))

    await waitFor(() => expect(screen.getByText('Draft full document package')).toBeTruthy())
    expect(screen.getByRole('link', { name: /Matter/ }).getAttribute('href')).toBe(
      `/admin/matters/${MATTER_ID}`,
    )
  })
})

describe('the plan API reports the matter', () => {
  it('returns an id and a display name alongside the tasks', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/matters/[matterId]/tasks/route.ts'),
      'utf8',
    )
    expect(route).toContain('matter: {')
    // client_name first, then the matter's own name — the same precedence the
    // task queue's record labels use.
    expect(route).toContain('client_name')
    expect(route.indexOf("(matter?.client_name as string | null)")).toBeLessThan(
      route.indexOf("(matter?.name as string | null)"),
    )
  })
})
