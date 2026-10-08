// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TodayQueueRow } from '@/lib/queries/today'
import type { TaskRow } from '@/lib/tasks/types'
import { taskFixture } from './fixtures/task'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const taskActions = vi.hoisted(() => ({
  complete: vi.fn(),
  snooze: vi.fn(),
  isPending: vi.fn(() => false),
}))

vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))
vi.mock('@/components/tasks/useTaskActions', () => ({ useTaskActions: () => taskActions }))
vi.mock('@/lib/sidebarCountsClient', () => ({ invalidateSidebarCountsClient: vi.fn() }))

import { TodayQueue } from '@/app/admin/components/TodayQueue'

function agingRow(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    entity: 'matter',
    id: 'matter-1',
    client_name: 'Later Matter',
    client_email: 'later@example.com',
    client_phone: '6175550100',
    track: 'estate_planning',
    current_stage: 'drafting',
    stage_order: 4,
    owner: 'attorney',
    stage_entered_at: '2026-08-01T12:00:00.000Z',
    days_in_stage: 4,
    sla_days: 7,
    escalation_offset: 2,
    is_overdue: false,
    needs_outreach: false,
    health: 'amber',
    raw_health: 'amber',
    days_over_sla: 2,
    snooze_id: null,
    snoozed_until: null,
    snooze_reason: null,
    is_snoozed: false,
    stage_visits: 1,
    cumulative_days: 0,
    cumulative_sla_days: null,
    is_cumulative_overdue: false,
    is_scheduled: false,
    stage_clock_suspect: false,
    action: { kind: 'draft', label: 'Draft', href: '/admin/drafting/matter-1' },
    nudge_matter_id: null,
    ...overrides,
  }
}

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return taskFixture({
    id: 'task-1',
    title: 'File petition',
    description: null,
    status: 'open',
    priority: 'high',
    source: 'manual',
    task_type: 'single',
    checklist: [],
    matter_id: 'matter-1',
    lead_id: null,
    stage_key: null,
    stage_entered_at: null,
    batch_tag: null,
    soft_due_at: null,
    hard_due_at: null,
    due_at: '2026-08-14T12:00:00.000Z',
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
    record_name: 'Jordan Family',
    assignee_name: null,
    ...overrides,
  })
}

function renderQueue(overrides: Partial<React.ComponentProps<typeof TodayQueue>> = {}) {
  return render(
    <TodayQueue
      waitingOnYou={[]}
      waitingOnClient={[]}
      snoozed={[]}
      unreadThreads={[]}
      intakeReview={[]}
      intakeToSend={[]}
      overdueTasks={[]}
      tasksDueToday={[]}
      {...overrides}
    />,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  router.push.mockReset()
  router.refresh.mockReset()
  taskActions.complete.mockReset()
  taskActions.snooze.mockReset()
  taskActions.isPending.mockReset()
  taskActions.isPending.mockReturnValue(false)
})

describe('Today decision queue', () => {
  it('promotes one top action, orders the remaining decisions, and keeps later work collapsed', async () => {
    const user = userEvent.setup()
    renderQueue({
      overdueTasks: [
        task(),
        task({ id: 'task-2', title: 'Record deed' }),
      ],
      tasksDueToday: [task({ id: 'task-3', title: 'Call client', due_at: '2026-08-16T12:00:00.000Z' })],
      waitingOnYou: [
        agingRow({ id: 'blocking', client_name: 'Blocked Client', days_over_sla: 9, health: 'red' }),
        agingRow(),
      ],
      unreadThreads: [{ matter_id: 'message-1', client_name: 'Message Client', unread_count: 2, latest_at: '2026-08-16T10:00:00.000Z' }],
      intakeReview: [{ matter_id: 'review-1', client_name: 'Review Client', stage_label: 'Intake review' }],
      intakeToSend: [{ matter_id: 'send-1', client_name: 'Send Client', stage_label: 'Lead' }],
    })

    const primary = screen.getByRole('region', { name: 'Up next' })
    expect(within(primary).getByText('File petition')).toBeTruthy()
    expect(screen.getAllByText('File petition')).toHaveLength(1)

    const headings = screen.getAllByRole('heading').map(node => node.textContent)
    expect(headings).toEqual(expect.arrayContaining([
      expect.stringContaining('Overdue'),
      expect.stringContaining('Blocking'),
      expect.stringContaining('Due today'),
      expect.stringContaining('Unread client messages'),
      expect.stringContaining('Intake ready for review'),
    ]))
    const positions = ['Overdue', 'Blocking', 'Due today', 'Unread client messages', 'Intake ready for review']
      .map(label => headings.findIndex(text => text?.includes(label)))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    expect(screen.queryByText('Later Matter')).toBeNull()
    expect(screen.queryByText('Send Client')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Later/i }))
    expect(screen.getByText('Later Matter')).toBeTruthy()
    expect(screen.getByText('Send Client')).toBeTruthy()
  })

  it('shows the shared lead recommendation and uses it for keyboard actions', async () => {
    const user = userEvent.setup()
    renderQueue({ waitingOnYou: [agingRow({
      entity: 'lead', id: 'lead-1', client_name: 'Lena Prospect',
      action: { kind: 'send_intake', label: 'Send intake', title: 'Send intake to get the facts', detail: 'Intake has never been sent.', href: '/admin/leads/lead-1' },
    })] })
    const next = screen.getByRole('region', { name: 'Up next' })
    expect(within(next).getByText('Lena Prospect')).toBeTruthy()
    expect(within(next).getByText('Send intake to get the facts')).toBeTruthy()
    expect(within(next).getByText('Intake has never been sent.')).toBeTruthy()
    expect(within(next).getByRole('link', { name: 'Send intake' }).getAttribute('href')).toBe('/admin/leads/lead-1')
    expect(screen.queryByText('Send booking link')).toBeNull()
    await user.keyboard('je')
    expect(router.push).toHaveBeenCalledWith('/admin/leads/lead-1')
  })

  it('previews email recipients and skips missing addresses before sending bulk nudges', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'sent' }) })
    vi.stubGlobal('fetch', fetchMock)

    renderQueue({
      waitingOnClient: [
        agingRow({
          id: 'eligible',
          client_name: 'Avery Stone',
          client_email: 'avery@example.com',
          owner: 'client',
          nudge_matter_id: 'eligible',
        }),
        agingRow({
          id: 'missing-email',
          client_name: 'Morgan Reed',
          client_email: null,
          owner: 'client',
          nudge_matter_id: 'missing-email',
        }),
        agingRow({
          id: 'not-an-intake',
          client_name: 'Not Included',
          owner: 'client',
          nudge_matter_id: null,
        }),
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Nudge all' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Review intake reminders' })
    expect(within(dialog).getByText('Avery Stone')).toBeTruthy()
    expect(within(dialog).getByText('avery@example.com')).toBeTruthy()
    expect(within(dialog).getByText('Email')).toBeTruthy()
    expect(within(dialog).getByText('Morgan Reed')).toBeTruthy()
    expect(within(dialog).getByText(/No email on file.*skipped/i)).toBeTruthy()
    expect(within(dialog).queryByText('Not Included')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Send 1 email' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/intake/send')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ matterId: 'eligible' })
  })
})

describe('a backlog of overdue work', () => {
  it('previews it like every other long group instead of rendering all of it', async () => {
    // The group used to render every row, which was survivable only because a
    // truncated read showed one of them: the firm had 27 overdue tasks and
    // Today listed 1. Now that all of them arrive, the list previews.
    const user = userEvent.setup()
    renderQueue({
      overdueTasks: Array.from({ length: 13 }, (_, index) =>
        task({
          id: `overdue-${index}`,
          title: `Overdue task ${index}`,
          due_at: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
        }),
      ),
    })

    // One goes to "Up next", ten preview, and the rest are behind a click.
    expect(screen.getByText('Overdue task 0')).toBeTruthy()
    expect(screen.getByText('Overdue task 10')).toBeTruthy()
    expect(screen.queryByText('Overdue task 11')).toBeNull()
    expect(screen.queryByText('Overdue task 12')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Show 2 more' }))

    expect(screen.getByText('Overdue task 11')).toBeTruthy()
    expect(screen.getByText('Overdue task 12')).toBeTruthy()
  })
})
