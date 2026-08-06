// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { TaskDetailSheet } from '@/components/tasks/TaskDetailSheet'
import type { TaskRow } from '@/lib/tasks/types'

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    title: 'Send the trust draft',
    description: null,
    status: 'open',
    priority: 'normal',
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
    due_at: null,
    assignee_id: null,
    estimate_minutes: null,
    remind_at: null,
    recurrence: null,
    template_id: null,
    document_id: null,
    completed_at: null,
    completed_by: null,
    created_by: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderSheet(row: TaskRow) {
  return render(
    <TaskDetailSheet
      task={row}
      open
      onOpenChange={vi.fn()}
      onUpdated={vi.fn()}
      onDeleted={vi.fn()}
    />,
  )
}

afterEach(cleanup)

describe('TaskDetailSheet related record', () => {
  it('links a matter task to its matter', () => {
    renderSheet(task({ matter_id: 'm-1', record_name: 'Whitfield, Margaret' }))

    const link = screen.getByRole('link', { name: 'Whitfield, Margaret' })
    expect(link.getAttribute('href')).toBe('/admin/matters/m-1')
  })

  it('links a lead task to its lead', () => {
    renderSheet(task({ lead_id: 'l-9', record_name: 'Harold Pike' }))

    expect(screen.getByRole('link', { name: 'Harold Pike' }).getAttribute('href')).toBe(
      '/admin/leads/l-9',
    )
  })

  it('says so when the task hangs off nothing', () => {
    renderSheet(task())

    expect(screen.getByText('No related record')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
