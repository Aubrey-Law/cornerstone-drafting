// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
import { TaskPlanView } from '@/components/tasks/TaskPlanView'
import { toPlanTask } from '@/lib/slaTasks/plan'
import { taskFixture } from './fixtures/task'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it.each(['board', 'table'] as const)('keeps plan ownership, dates and editing in %s', async presentation => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [toPlanTask(taskFixture({ id: 'a', title: 'Client signs', owner: 'client', phase: 'signing', hard_due_at: '2026-10-09T12:00:00Z', matter_id: 'matter-1' }))], progress: null, anchors: null, matter: { id: 'matter-1', name: 'Smith' } }) })
  vi.stubGlobal('fetch', fetcher)
  render(<TaskPlanView matterId="matter-1" enabled presentation={presentation} />)
  await waitFor(() => expect(screen.getByText('Client signs')).toBeInTheDocument())
  expect(screen.getAllByText('client').length).toBeGreaterThan(0)
  expect(screen.getByRole('link', { name: 'Smith' })).toBeInTheDocument()
  const checkbox = screen.getByRole('checkbox')
  fireEvent.click(checkbox)
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true))
})
