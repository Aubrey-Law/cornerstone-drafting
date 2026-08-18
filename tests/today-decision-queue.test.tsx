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

    const primary = screen.getByRole('region', { name: 'Do this next' })
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
