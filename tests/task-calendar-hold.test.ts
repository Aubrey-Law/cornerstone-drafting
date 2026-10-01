import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchAllBusy: vi.fn(),
  createCalendarHold: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/appointments/calendarBusy', () => ({
  AvailabilityUnavailableError: class AvailabilityUnavailableError extends Error {},
  fetchAllBusy: mocks.fetchAllBusy,
}))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarHold: mocks.createCalendarHold,
}))

import { createTaskCalendarHold } from '@/lib/tasks/calendarHold'

function selection(result: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'contains', 'limit']) {
    chain[method] = () => chain
  }
  chain.maybeSingle = () => Promise.resolve(result)
  return chain
}

function makeAdmin(existing: Record<string, unknown> | null = null) {
  const inserted: Record<string, unknown>[] = []
  let appointmentCalls = 0
  const admin = {
    from: vi.fn((table: string) => {
      if (table === 'appointment_types') {
        return selection({ data: { id: 'type-1', key: 'task_block' }, error: null })
      }
      if (table !== 'appointments') throw new Error(`Unexpected table ${table}`)
      appointmentCalls += 1
      if (appointmentCalls === 1) {
        return selection({ data: existing, error: null })
      }
      if (appointmentCalls === 2) {
        return {
          insert: (payload: Record<string, unknown>) => {
            inserted.push(payload)
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'appointment-1' }, error: null }),
              }),
            }
          },
        }
      }
      return {
        update: () => ({
          eq: () => ({ is: () => Promise.resolve({ error: null }) }),
        }),
      }
    }),
  }
  return { admin, inserted }
}

const task = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Prepare signing packet',
  matter_id: '22222222-2222-4222-8222-222222222222',
  lead_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchAllBusy.mockResolvedValue([])
  mocks.createCalendarHold.mockResolvedValue({ eventId: 'google-1', onlineMeetingUrl: null })
})

describe('task calendar holds', () => {
  it('uses the task id as an idempotency key and returns the active hold on retry', async () => {
    const { admin } = makeAdmin({
      id: 'appointment-existing',
      start_time: '2026-10-01T14:00:00Z',
      end_time: '2026-10-01T14:30:00Z',
      google_event_id: 'google-existing',
    })

    const result = await createTaskCalendarHold({
      admin: admin as never,
      task,
      startAt: '2026-10-01T15:00:00Z',
      durationMinutes: 30,
      showAsBusy: true,
      actorId: 'user-1',
      actorEmail: 'attorney@example.com',
    })

    expect(result).toMatchObject({ appointmentId: 'appointment-existing', alreadyExists: true })
    expect(mocks.fetchAllBusy).not.toHaveBeenCalled()
    expect(mocks.createCalendarHold).not.toHaveBeenCalled()
  })

  it('links a new appointment to the original task instead of creating another task', async () => {
    const { admin, inserted } = makeAdmin()
    const result = await createTaskCalendarHold({
      admin: admin as never,
      task,
      startAt: '2026-10-01T15:00:00Z',
      durationMinutes: 30,
      showAsBusy: true,
      actorId: 'user-1',
      actorEmail: 'attorney@example.com',
    })

    expect(result).toMatchObject({ appointmentId: 'appointment-1', alreadyExists: false, calendarSynced: true })
    expect(inserted[0]).toMatchObject({
      linked_matter_id: task.matter_id,
      raw: { source: 'task_calendar_hold', taskId: task.id, taskTitle: task.title },
    })
    expect(mocks.createCalendarHold).toHaveBeenCalledOnce()
  })

  it('rejects a conflicting block before writing an appointment', async () => {
    const { admin, inserted } = makeAdmin()
    mocks.fetchAllBusy.mockResolvedValue([{
      start: Date.parse('2026-10-01T14:45:00Z'),
      end: Date.parse('2026-10-01T15:15:00Z'),
    }])

    await expect(createTaskCalendarHold({
      admin: admin as never,
      task,
      startAt: '2026-10-01T15:00:00Z',
      durationMinutes: 30,
      showAsBusy: true,
      actorId: 'user-1',
      actorEmail: 'attorney@example.com',
    })).rejects.toMatchObject({ status: 409 })
    expect(inserted).toEqual([])
  })
})
