// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DailyPlanPreview, WorkItem } from '@/lib/work/types'
import { DEFAULT_WORK_PREFERENCES } from '@/lib/work/types'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { CommandCenter } from '@/app/admin/components/CommandCenter'

afterEach(cleanup)

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: 'task:planned',
    sourceType: 'task',
    sourceIds: ['task-1'],
    evidence: [],
    record: { type: 'matter', id: 'matter-1', name: 'Jordan Client' },
    title: 'Planned drafting block',
    actionLabel: 'Open',
    href: '/admin/matters/matter-1',
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [],
    estimateMinutes: 45,
    ...overrides,
  }
}

function preview(items: WorkItem[]): DailyPlanPreview {
  const now = items[0] ?? null
  return {
    date: '2026-10-10',
    now,
    mustDo: items.filter(row => row.priorityBand <= 1),
    suggested: [],
    communication: [],
    waiting: [],
    later: items.filter(row => row.priorityBand > 1),
    blocks: [],
    capacityMinutes: 192,
    plannedMinutes: items.reduce((sum, row) => sum + row.estimateMinutes, 0),
    criticalMinutes: items.filter(row => row.priorityBand === 0).reduce((sum, row) => sum + row.estimateMinutes, 0),
    overloadMinutes: 0,
    overload: false,
    appointments: [],
  }
}

describe('Command Center mid-day critical interrupt', () => {
  it('offers Insert into Focus without silently replacing the committed order', () => {
    const planned = item()
    const critical = item({
      workKey: 'task:critical-fire',
      priorityBand: 0,
      title: 'Hard deadline fire drill',
      estimateMinutes: 30,
    })
    const planPreview = preview([planned, critical])

    render(<CommandCenter
      initialPreview={planPreview}
      preferences={DEFAULT_WORK_PREFERENCES}
      initialPlan={{
        id: 'plan-1',
        status: 'committed',
        calendarStatus: null,
        items: [{
          work_key: planned.workKey,
          lane: 'must_do',
          position: 0,
          status: 'planned',
        }],
      }}
      initialApprovals={[]}
      sourceErrors={[]}
      canDelegate={false}
    />)

    // Committed days open in Focus on the planned item.
    expect(screen.getByText('Focus mode')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /View full plan/i }))

    expect(screen.getByText(/New critical work appeared after you committed/i)).toBeTruthy()
    expect(screen.getAllByText('Hard deadline fire drill').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Insert into Focus/i }))
    expect(screen.getByText('Focus mode')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Hard deadline fire drill' })).toBeTruthy()
  })
})
