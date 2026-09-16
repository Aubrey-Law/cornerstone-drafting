import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ enabled: false, rpc: vi.fn(), prepare: vi.fn(), lawmatics: vi.fn(), statular: vi.fn() }))
vi.mock('@/lib/integrations/lawmatics/jobs', () => ({ runLawmaticsAppointmentSyncJob: mocks.lawmatics }))
vi.mock('@/lib/integrations/statular/jobs', () => ({ runStatularClientSyncJob: mocks.statular }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { durable_workflow_jobs_enabled: mocks.enabled }, error: null }) }) }) }) }) }))
vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({ ensureDesignSheetSeededFromIntake: vi.fn() }))
vi.mock('@/lib/slaTasks/generate', () => ({ ensureMatterSlaTasks: vi.fn() }))
vi.mock('@/lib/stage-engine/fireStageTasks', () => ({ fireEngineStageTask: vi.fn() }))
vi.mock('@/lib/billing/prepareInvoiceReminders', () => ({ prepareInvoiceReminderDrafts: mocks.prepare }))
import { processWorkflowJobs } from '@/lib/workflowJobs'
const job = { id: 'job', claim_token: 'claim', job_type: 'prepare_invoice_reminders', attempts: 1, max_attempts: 5, payload: {}, matter_id: null, lease_expires_at: '' }
beforeEach(() => {
  mocks.enabled = false
  mocks.rpc.mockReset()
  mocks.prepare.mockReset()
  mocks.lawmatics.mockReset()
  mocks.statular.mockReset()
})
describe('bounded workflow worker', () => {
  it('dispatches a Lawmatics job and finishes it with the existing claim token', async () => {
    mocks.enabled = true
    const payload = { appointmentId: 'appointment-1', sourceVersion: 'version-1' }
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_workflow_jobs_v2'
      ? [{ ...job, job_type: 'lawmatics_sync_appointment', payload }] : true, error: null }))
    expect(await processWorkflowJobs(1)).toMatchObject({ succeeded: 1, failed: 0 })
    expect(mocks.lawmatics).toHaveBeenCalledWith('appointment-1', 'version-1', expect.any(AbortSignal))
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_workflow_job_v3', {
      p_job_id: 'job', p_claim_token: 'claim', p_error: undefined, p_retry_after_ms: undefined,
    })
  })
  it('validates and dispatches a Statular client job with the worker signal', async () => {
    mocks.enabled = true
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_workflow_jobs_v2'
      ? [{ ...job, job_type: 'statular_create_client', payload: { clientIntakeId: 'lead-1' } }]
      : true, error: null }))
    expect(await processWorkflowJobs(1)).toMatchObject({ succeeded: 1, failed: 0 })
    expect(mocks.statular).toHaveBeenCalledWith('lead-1', expect.any(AbortSignal))
  })
  it.each([{}, { clientIntakeId: '' }, { clientIntakeId: 12 }])('rejects malformed Statular payload without dispatching: %j', async payload => {
    mocks.enabled = true
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_workflow_jobs_v2'
      ? [{ ...job, job_type: 'statular_create_client', payload }]
      : true, error: null }))
    expect(await processWorkflowJobs(1)).toMatchObject({ succeeded: 0, failed: 1 })
    expect(mocks.statular).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenLastCalledWith('finish_workflow_job_v3', expect.objectContaining({
      p_error: 'statular_create_client requires clientIntakeId',
    }))
  })
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
  it.each(['claim_workflow_jobs_v2', 'finish_workflow_job_v3'])('does not expose database detail when %s fails', async failingRpc => {
    mocks.enabled = true
    mocks.rpc.mockImplementation(async (name: string) => name === failingRpc
      ? { data: null, error: { message: 'PRIVATE-SNAPSHOT-CLAIM-TOKEN' } }
      : { data: name === 'claim_workflow_jobs_v2' ? [job] : true, error: null })
    const error = await processWorkflowJobs(1, { run: async () => {} }).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain('PRIVATE')
  })
})
