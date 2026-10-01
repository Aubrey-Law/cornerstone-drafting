import { describe, expect, it } from 'vitest'
import { buildWorkGraph } from '@/lib/work/buildWorkGraph'
import { compareWorkItems, dedupeWorkItems } from '@/lib/work/ranking'
import type { TodayData, TodayQueueRow } from '@/lib/queries/today'
import type { TaskRow } from '@/lib/tasks/types'
import type { WorkItem } from '@/lib/work/types'
import { reconcileWorkGraphs } from '@/lib/work/reconciliation'

const NOW = new Date('2026-09-30T14:00:00.000Z')

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Prepare filing', description: null, status: 'open', priority: 'normal', source: 'manual',
    task_type: 'single', checklist: [], matter_id: null, lead_id: null, stage_key: null,
    stage_entered_at: null, batch_tag: null, soft_due_at: null, hard_due_at: null,
    due_at: null, assignee_id: null, estimate_minutes: null, remind_at: null, recurrence: null,
    template_id: null, document_id: null, completed_at: null, completed_by: null, created_by: null,
    created_at: '2026-09-20T14:00:00.000Z', updated_at: '2026-09-20T14:00:00.000Z',
    phase: null, owner: 'firm', plan_template_id: null, sort_order: 0, skill: null, notes: null,
    plan_start_date: null, relative_to: null, due_offset_days: null, nudge_offset_days: null,
    escalation_offset_days: null, nudge_at: null, nudge_tier: null, escalation_at: null,
    escalation_tier: null, nudge_sent_at: null, escalation_sent_at: null, pauses_clock: false,
    paused_at: null, total_paused_days: 0, pre_engagement: false, auto: false, conditional: false,
    gate: null, variant: null, extends_target_days: null, recurring_interval_days: null,
    triggers_day_zero: false, skipped_at: null, closeout_reason: null,
    ...overrides,
  }
}

function aging(overrides: Partial<TodayQueueRow> = {}): TodayQueueRow {
  return {
    entity: 'matter', id: '10000000-0000-4000-8000-000000000001', client_name: 'A Client',
    client_email: null, client_phone: null, track: 'estate_planning', current_stage: 'intake',
    stage_order: 1, owner: 'attorney', stage_entered_at: '2026-09-01T12:00:00.000Z',
    days_in_stage: 20, sla_days: 5, escalation_offset: null, is_overdue: true,
    needs_outreach: false, health: 'red', raw_health: 'red', days_over_sla: 15,
    snooze_id: null, snoozed_until: null, snooze_reason: null, is_snoozed: false,
    stage_visits: 1, cumulative_days: 20, cumulative_sla_days: null,
    is_cumulative_overdue: false, is_scheduled: false, stage_clock_suspect: false,
    action: { kind: 'send-intake', label: 'Send intake', href: '/admin/matters/10000000-0000-4000-8000-000000000001' },
    nudge_matter_id: null,
    ...overrides,
  }
}

function today(overrides: Partial<TodayData> = {}): TodayData {
  return {
    atRisk: [], waitingOnYou: [], waitingOnClient: [], snoozed: [], unreadThreads: [],
    intakeReview: [], intakeToSend: [], appointmentsToday: [], overdueTasks: [], tasksDueToday: [],
    activeMatterCount: 0, needsYou: 0, overdueCount: 0, overdueMatterCount: 0, overdueLeadCount: 0,
    billing: { unbilledCount: 0, unbilledCents: 0, overdueInvoices: [], overdueCents: 0 },
    ...overrides,
  }
}

describe('canonical work graph', () => {
  it('ranks a production-scale task fixture without losing or duplicating work', () => {
    const tasks = Array.from({ length: 2_000 }, (_, index) => task({
      id: `00000000-0000-4000-8${String(index).padStart(3, '0')}-000000000001`,
      due_at: '2026-09-30T16:00:00.000Z',
    }))
    const graph = buildWorkGraph({ today: today({ tasksDueToday: tasks }) }, NOW)

    // The 1.5-second user-facing SLO is enforced with production rollout telemetry.
    // Wall-clock microbenchmarks inside the parallel CI suite are runner-contention dependent.
    expect(graph.items).toHaveLength(2_000)
    expect(new Set(graph.items.map(item => item.workKey))).toHaveProperty('size', 2_000)
    expect(graph.items.every(item => item.priorityBand === 1)).toBe(true)
  })

  it('puts overdue hard deadlines in Critical and ordinary overdue work in Must do', () => {
    const graph = buildWorkGraph({ today: today({ overdueTasks: [
      task({ id: '00000000-0000-4000-8000-000000000001', hard_due_at: '2026-09-29T16:00:00.000Z' }),
      task({ id: '00000000-0000-4000-8000-000000000002', due_at: '2026-09-29T16:00:00.000Z' }),
    ] }) }, NOW)
    expect(graph.items.map(item => [item.workKey, item.priorityBand])).toEqual([
      ['task:00000000-0000-4000-8000-000000000001', 0],
      ['task:00000000-0000-4000-8000-000000000002', 1],
    ])
  })

  it('keeps client-owned work out of the executable queue', () => {
    const graph = buildWorkGraph({ today: today({ waitingOnClient: [aging({ owner: 'client' })] }) }, NOW)
    expect(graph.items[0]).toMatchObject({ owner: 'client', state: 'waiting', priorityBand: 4 })
  })

  it('surfaces unreviewed client uploads as canonical matter attention', () => {
    const graph = buildWorkGraph({
      today: today(),
      documentReviews: [{
        matterId: '10000000-0000-4000-8000-000000000001',
        matterName: 'A Client',
        intakeCount: 1,
        portalCount: 2,
      }],
    }, NOW)

    expect(graph.items).toContainEqual(expect.objectContaining({
      workKey: 'matter:10000000-0000-4000-8000-000000000001:review-uploads',
      sourceType: 'document_review',
      title: 'Review 3 new client uploads',
      priorityBand: 1,
      estimateMinutes: 20,
    }))
  })

  it('collapses identical stable obligations and retains both evidence sources', () => {
    const base = aging()
    const graph = buildWorkGraph({ today: today({
      waitingOnYou: [base],
      intakeToSend: [{ matter_id: base.id, client_name: 'A Client', matter_name: null, matter_created: '2026-09-01T12:00:00.000Z' } as never],
    }) }, NOW)
    const item = graph.items.find(candidate => candidate.workKey === `matter:${base.id}:send-intake`)
    expect(item).toBeTruthy()
    expect(item?.evidence).toHaveLength(2)
  })

  it('uses every documented tie-break before the stable key', () => {
    const base: WorkItem = {
      workKey: 'task:b', sourceType: 'task', sourceIds: ['b'], evidence: [],
      record: { type: 'firm', name: 'Firm' }, title: 'B', actionLabel: 'Start', href: '/admin/tasks',
      owner: 'firm', state: 'open', priorityBand: 1, priorityReasons: [], estimateMinutes: 30,
    }
    const urgent = { ...base, workKey: 'task:a', hardDueAt: '2026-10-01T12:00:00.000Z' }
    const later = { ...base, hardDueAt: '2026-10-02T12:00:00.000Z' }
    expect(compareWorkItems(urgent, later)).toBeLessThan(0)
    expect(dedupeWorkItems([later, urgent]).map(item => item.workKey)).toEqual(['task:a', 'task:b'])
  })

  it('moves active snoozes to Waiting without erasing the source item', () => {
    const graph = buildWorkGraph({
      today: today({ tasksDueToday: [task({ due_at: '2026-09-30T16:00:00.000Z' })] }),
      overrides: [{
        work_key: 'task:00000000-0000-4000-8000-000000000001', state: 'snoozed',
        snoozed_until: '2026-10-01T14:00:00.000Z', assigned_to: null, note: null,
      }],
    }, NOW)
    expect(graph.items[0]).toMatchObject({ state: 'snoozed', priorityBand: 4 })
  })

  it('uses calendar-only busy time for planning without inventing a preparation obligation', () => {
    const graph = buildWorkGraph({ today: today({ appointmentsToday: [{
      id: 'calendar-busy:2026-09-30T15:00:00.000Z:2026-09-30T16:00:00.000Z',
      matter_id: null,
      client_name: null,
      next_appointment: '2026-09-30T15:00:00.000Z',
      end_at: '2026-09-30T16:00:00.000Z',
      next_appointment_type: 'Calendar commitment',
      href: '/admin/calendar',
      is_all_day: false,
    }] }) }, NOW)

    expect(graph.items).toEqual([])
    expect(graph.appointments).toHaveLength(1)
  })

  it('reconciles shadow and canonical queues without exposing source content', () => {
    const legacy = buildWorkGraph({ today: today({ tasksDueToday: [task({ due_at: '2026-09-30T16:00:00.000Z' })] }) }, NOW)
    const extra = task({ id: '00000000-0000-4000-8000-000000000002', due_at: '2026-10-01T16:00:00.000Z' })
    const canonical = buildWorkGraph({
      today: today({ tasksDueToday: [task({ due_at: '2026-09-30T16:00:00.000Z' })] }),
      futureTasks: [extra],
    }, NOW)

    expect(reconcileWorkGraphs(legacy, canonical)).toMatchObject({
      legacyCount: 1,
      canonicalCount: 2,
      mappedCount: 1,
      coveragePercent: 100,
      omittedWorkKeys: [],
      duplicateWorkKeys: [],
      additionalCanonicalWorkKeys: [`task:${extra.id}`],
    })
  })
})
