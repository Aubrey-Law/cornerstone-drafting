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

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc }) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: async () => ({ err: null, userId: VIEWER, user: { id: VIEWER, email: 'a@example.test' } }),
}))
vi.mock('@/lib/draftPayload/resolveMatterId', () => ({ resolveMatterId: async () => MATTER }))
vi.mock('@/lib/stage-engine/fireStageTasks', () => ({ fireEngineStageTask }))
vi.mock('@/lib/tasks/closeout', () => ({
  archiveTasksForClosedRecord: archive,
  restoreTasksForReopenedRecord: restore,
}))

import { PATCH } from '@/app/api/admin/matters/[id]/stage/route'

function moveTo(stage: string, result: Record<string, unknown>) {
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
