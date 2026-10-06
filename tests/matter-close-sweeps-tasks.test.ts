import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Executed-handler tests for PATCH /api/admin/matters/[id]/stage.
 *
 * They exist because of a bug report that closing a matter left its tasks
 * open. The firm closes a matter from the Close-out card, which stamps the
 * closing date and moves the *stage* to `closed` — and only the status route
 * ever swept the checklist, so every unfinished plan row, stage task and
 * hand-added to-do stayed in the firm queue for work nobody would ever do.
 */

const MATTER = '44444444-4444-4444-8444-444444444444'
const VIEWER = 'attorney-1'

const rpc = vi.hoisted(() => vi.fn())
const archive = vi.hoisted(() => vi.fn(async () => 3))
const restore = vi.hoisted(() => vi.fn(async () => 3))
const fireEngineStageTask = vi.hoisted(() => vi.fn(async () => {}))
const loadMatterLifecycleContext = vi.hoisted(() => vi.fn())
const finishMatterClose = vi.hoisted(() => vi.fn(async () => ({ closedOn: '2026-10-06', retentionUntil: '2032-10-06', noticeOffered: true })))

const lifecycleQuery = () => ({
  select: () => ({
    eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
  }),
})

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc, from: lifecycleQuery }) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: async () => ({ err: null, userId: VIEWER, user: { id: VIEWER, email: 'a@example.test' } }),
}))
vi.mock('@/lib/draftPayload/resolveMatterId', () => ({ resolveMatterId: async () => MATTER }))
vi.mock('@/lib/stage-engine/fireStageTasks', () => ({ fireEngineStageTask }))
vi.mock('@/lib/lifecycle/server', () => ({ loadMatterLifecycleContext }))
vi.mock('@/lib/tasks/closeout', () => ({
  archiveTasksForClosedRecord: archive,
  restoreTasksForReopenedRecord: restore,
}))
vi.mock('@/lib/fileClosing/server', () => ({ finishMatterClose }))

import { PATCH } from '@/app/api/admin/matters/[id]/stage/route'
import { LIFECYCLE_REGISTRY_VERSION } from '@/lib/lifecycle/registry'

function moveTo(stage: string, result: Record<string, unknown>) {
  loadMatterLifecycleContext.mockResolvedValue({
    matter: {
      matter_id: MATTER,
      stage: typeof result.previousStage === 'string' ? result.previousStage : 'drafting',
      intake_status: 'completed',
      intake_submitted_at: '2026-01-01T00:00:00.000Z',
      design_status: 'ready',
      drafts_sent_at: '2026-01-02T00:00:00.000Z',
      signing_date: '2026-01-03',
      documents_executed_at: '2026-01-04T00:00:00.000Z',
    },
    engagement: { signed: true, sentAt: '2026-01-01T00:00:00.000Z', status: 'signed' },
    reviewFlags: [],
  })
  rpc.mockResolvedValue({
    data: { matterId: MATTER, stage, previousStage: 'drafting', unchanged: false, durableJobs: false, ...result },
    error: null,
  })
  return PATCH(
    new Request(`http://localhost/api/admin/matters/${MATTER}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage }),
    }),
    { params: Promise.resolve({ id: MATTER }) },
  )
}

beforeEach(() => {
  rpc.mockReset()
  archive.mockClear()
  restore.mockClear()
  fireEngineStageTask.mockClear()
  loadMatterLifecycleContext.mockReset()
  finishMatterClose.mockClear()
})

describe('closing a matter', () => {
  it('archives the open tasks the closed matter leaves behind', async () => {
    const res = await moveTo('closed', {})

    expect(res.status).toBe(200)
    expect(archive).toHaveBeenCalledWith(
      expect.anything(),
      { matterId: MATTER },
      'matter_closed',
      expect.objectContaining({ id: VIEWER }),
    )
    expect(restore).not.toHaveBeenCalled()
  })

  it('closes the status axis first, so the billing check runs before the stage moves', async () => {
    await moveTo('closed', {})

    const calls = rpc.mock.calls.map(call => call[0])
    expect(calls).toEqual(['transition_matter_status_with_closeout', 'transition_matter_stage_with_jobs'])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_matter_id: MATTER, p_status: 'closed', p_actor_id: VIEWER })
    // The closed date, the retention date and the client's closing notice.
    expect(finishMatterClose).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ matterId: MATTER, actor: expect.objectContaining({ id: VIEWER }) }))
  })

  it('refuses the close when billing is unresolved, before anything moves', async () => {
    loadMatterLifecycleContext.mockResolvedValue({
      matter: {
        matter_id: MATTER, stage: 'funding', intake_status: 'completed', intake_submitted_at: '2026-01-01T00:00:00.000Z',
        design_status: 'ready', drafts_sent_at: '2026-01-02T00:00:00.000Z', signing_date: '2026-01-03', documents_executed_at: '2026-01-04T00:00:00.000Z',
      },
      engagement: { signed: true, sentAt: '2026-01-01T00:00:00.000Z', status: 'signed' },
      reviewFlags: [],
    })
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Resolve billing before close-out: balance 330000, open claims 0, ready milestones 0, payment exceptions 0' } })

    const res = await PATCH(
      new Request(`http://localhost/api/admin/matters/${MATTER}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: 'closed' }) }),
      { params: Promise.resolve({ id: MATTER }) },
    )

    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('Resolve billing before close-out')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(archive).not.toHaveBeenCalled()
    expect(finishMatterClose).not.toHaveBeenCalled()
  })

  it('reopens the status axis when the matter leaves closed by stage', async () => {
    await moveTo('funding', { previousStage: 'closed' })

    const reopen = rpc.mock.calls.find(call => call[0] === 'transition_matter_status_with_closeout')
    expect(reopen?.[1]).toMatchObject({ p_matter_id: MATTER, p_status: 'active' })
    expect(finishMatterClose).not.toHaveBeenCalled()
  })

  it('leaves every other stage move alone', async () => {
    await moveTo('signing_scheduled', {})

    expect(archive).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
  })

  it('does not re-sweep when the matter is already at that stage', async () => {
    await moveTo('closed', { previousStage: 'closed', unchanged: true })

    expect(archive).not.toHaveBeenCalled()
  })

  it('puts back exactly what the close archived when the matter reopens', async () => {
    await moveTo('funding', { previousStage: 'closed' })

    // Scoped: a lead's held-back plan and a hand-skipped task carry their own
    // markers, and reopening a matter is not a reason to revive those.
    expect(restore).toHaveBeenCalledWith(
      expect.anything(),
      { matterId: MATTER },
      expect.objectContaining({ id: VIEWER }),
      { reasons: ['matter_closed'] },
    )
    expect(archive).not.toHaveBeenCalled()
  })
})

describe('lifecycle preflight', () => {
  function blockedContext() {
    return {
      matter: {
        matter_id: MATTER,
        stage: 'intake',
        practice_area: 'EP',
        intake_status: null,
        intake_sent_at: null,
        intake_submitted_at: null,
      },
      engagement: undefined,
      reviewFlags: [],
    }
  }

  it('returns blockers without calling the stage RPC', async () => {
    loadMatterLifecycleContext.mockResolvedValue(blockedContext())

    const res = await PATCH(new Request(`http://localhost/api/admin/matters/${MATTER}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage: 'design' }),
    }), { params: Promise.resolve({ id: MATTER }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.lifecycle.blockers.map((blocker: { key: string }) => blocker.key)).toEqual([
      'matter.intake_sent', 'matter.intake_complete',
    ])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('revalidates the exact registry version and blocker set before advancing', async () => {
    loadMatterLifecycleContext.mockResolvedValue(blockedContext())
    rpc.mockResolvedValue({
      data: { matterId: MATTER, stage: 'design', previousStage: 'intake', unchanged: false, durableJobs: true },
      error: null,
    })
    const request = (lifecycleVersion: string) => PATCH(
      new Request(`http://localhost/api/admin/matters/${MATTER}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({
          stage: 'design',
          confirmBlockers: true,
          lifecycleVersion,
          confirmedBlockerKeys: ['matter.intake_sent', 'matter.intake_complete'],
        }),
      }),
      { params: Promise.resolve({ id: MATTER }) },
    )

    expect((await request('stale-registry')).status).toBe(409)
    expect(rpc).not.toHaveBeenCalled()
    expect((await request(LIFECYCLE_REGISTRY_VERSION)).status).toBe(200)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
