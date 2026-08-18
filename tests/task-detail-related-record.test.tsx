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
import { taskFixture as task } from './fixtures/task'

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
      '/admin/crm/opportunities/l-9',
    )
  })

  it('says so when the task hangs off nothing', () => {
    renderSheet(task())

    expect(screen.getByText('No related record')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
