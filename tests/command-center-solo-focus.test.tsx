// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DailyPlanPreview, WorkItem } from '@/lib/work/types'
import { DEFAULT_WORK_PREFERENCES, SOLO_WORK_PREFERENCES } from '@/lib/work/types'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { CommandCenter } from '@/app/admin/components/CommandCenter'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:next',
    sourceType: 'task',
    sourceIds: ['task-1'],
    evidence: [{ sourceType: 'task', sourceId: 'task-1', href: '/admin/tasks' }],
    record: { type: 'matter', id: 'matter-1', name: 'Jordan Client' },
    title: 'Draft Jordan Client trust',
    actionLabel: 'Open',
    href: '/admin/matters/matter-1?tab=tasks',
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [{ code: 'due_today', label: 'Due today' }],
    estimateMinutes: 45,
    ...overrides,
  }
}

function preview(now: WorkItem | null = workItem()): DailyPlanPreview {
  const mustDo = now ? [now] : []
  return {
    date: '2026-10-10',
    now,
    mustDo,
    suggested: [],
    communication: [],
    waiting: [],
    later: [],
    blocks: [],
    capacityMinutes: 192,
    plannedMinutes: now?.estimateMinutes ?? 0,
    criticalMinutes: 0,
    overloadMinutes: 0,
    overload: false,
    appointments: [],
  }
}

describe('Command Center solo focus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
  })

  it('opens committed days in Focus mode on the next step', () => {
    const now = workItem()
    render(<CommandCenter
      initialPreview={preview(now)}
      preferences={DEFAULT_WORK_PREFERENCES}
      initialPlan={{
        id: 'plan-1',
        status: 'committed',
        calendarStatus: null,
        items: [{
          work_key: now.workKey,
          lane: 'must_do',
          position: 0,
          status: 'planned',
        }],
      }}
      initialApprovals={[]}
      sourceErrors={[]}
      canDelegate={false}
    />)

    expect(screen.getByText('Focus mode')).toBeTruthy()
    expect(screen.getByText('Only the next step')).toBeTruthy()
    expect(screen.getByText('Draft Jordan Client trust')).toBeTruthy()
    expect(screen.getByRole('button', { name: /View full plan/i })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Now' })).toBeNull()
  })

  it('keeps the full plan visible before a day is committed', () => {
    render(<CommandCenter
      initialPreview={preview()}
      preferences={DEFAULT_WORK_PREFERENCES}
      initialPlan={null}
      initialApprovals={[]}
      sourceErrors={[]}
      canDelegate={false}
    />)

    expect(screen.queryByText('Focus mode')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Focus now/i })).toBeTruthy()
  })

  it('lets Start run without a saved plan and hides Delegate for solo firms', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/admin/daily-plans/generate') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          plan: {
            id: 'plan-draft',
            status: 'draft',
            items: [{
              work_key: 'task:next',
              lane: 'must_do',
              position: 0,
              status: 'planned',
            }],
          },
          preview: preview(),
          calendarStatus: null,
        }), { status: 200 })
      }
      if (url.includes('/api/admin/actions/proposals') && init?.method === 'POST') {
        return new Response(JSON.stringify({ proposal: { id: 'proposal-1' } }), { status: 200 })
      }
      if (url.includes('/api/admin/actions/proposals/proposal-1/execute')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.includes('/api/admin/daily-plans/plan-draft') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.includes('/api/admin/work-items') || url.includes('/api/admin/daily-plans/current')) {
        return new Response(JSON.stringify({
          plan: preview(),
          preferences: DEFAULT_WORK_PREFERENCES,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CommandCenter
      initialPreview={preview()}
      preferences={DEFAULT_WORK_PREFERENCES}
      initialPlan={null}
      initialApprovals={[]}
      sourceErrors={[]}
      canDelegate={false}
    />)

    expect(screen.queryByRole('button', { name: /^Delegate$/i })).toBeNull()

    const start = screen.getAllByRole('button', { name: /^Start$/i })[0]
    expect(start.hasAttribute('disabled')).toBe(false)
    fireEvent.click(start)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/daily-plans/generate'))).toBe(true)
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/admin/actions/proposals') && !String(url).includes('/execute'))).toBe(true)
    })
  })

  it('exposes a solo practice preset in planning preferences', () => {
    render(<CommandCenter
      initialPreview={preview()}
      preferences={{ ...DEFAULT_WORK_PREFERENCES, maxMustDo: 5, adminBatchMinutes: 30 }}
      initialPlan={null}
      initialApprovals={[]}
      sourceErrors={[]}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Planning preferences/i }))
    fireEvent.click(screen.getByRole('button', { name: /Solo practice preset/i }))

    expect((screen.getByLabelText('Must-do limit') as HTMLInputElement).value).toBe(String(SOLO_WORK_PREFERENCES.maxMustDo))
    expect((screen.getByLabelText('Administrative batch') as HTMLSelectElement).value)
      .toBe(String(SOLO_WORK_PREFERENCES.adminBatchMinutes))
  })
})

describe('solo work preference defaults', () => {
  it('keeps factory defaults aligned with the solo practice preset', () => {
    expect(DEFAULT_WORK_PREFERENCES).toEqual(SOLO_WORK_PREFERENCES)
    expect(DEFAULT_WORK_PREFERENCES.maxMustDo).toBe(2)
    expect(DEFAULT_WORK_PREFERENCES.adminBatchMinutes).toBe(15)
  })
})
