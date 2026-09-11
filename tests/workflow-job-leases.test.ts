import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ enabled: false, rpc: vi.fn(), prepare: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { durable_workflow_jobs_enabled: mocks.enabled }, error: null }) }) }) }) }) }))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({ ensureDesignSheetSeededFromIntake: vi.fn() }))
vi.mock('@/lib/slaTasks/generate', () => ({ ensureMatterSlaTasks: vi.fn() }))
vi.mock('@/lib/stage-engine/fireStageTasks', () => ({ fireEngineStageTask: vi.fn() }))
vi.mock('@/lib/billing/prepareInvoiceReminders', () => ({ prepareInvoiceReminderDrafts: mocks.prepare }))
import { processWorkflowJobs } from '@/lib/workflowJobs'
const job = { id: 'job', claim_token: 'claim', job_type: 'prepare_invoice_reminders', attempts: 1, max_attempts: 5, payload: {}, matter_id: null, lease_expires_at: '' }
beforeEach(() => { mocks.enabled = false; mocks.rpc.mockReset(); mocks.prepare.mockReset() })
describe('bounded workflow worker', () => {
  it('returns before claiming or preparing reminders when disabled', async () => {
    expect(await processWorkflowJobs()).toMatchObject({ claimed: 0, disabled: true })
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled()
  })
  it('claims one at a time and stops with less than ten seconds available', async () => {
    mocks.enabled = true
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_workflow_jobs_v2' ? [job] : true, error: null }))
    let now = 0
    const result = await processWorkflowJobs(10, { now: () => now, run: async () => { now += 46_000 } })
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 })
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_limit: 1, p_lease_seconds: 120 })
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_claim_token: 'claim' })
  })
  it('does not count success when completion loses its claim', async () => {
    mocks.enabled = true
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_workflow_jobs_v2' ? [job] : false, error: null }))
    await expect(processWorkflowJobs(1, { run: async () => {} })).rejects.toThrow('completion was not recorded')
  })
})
