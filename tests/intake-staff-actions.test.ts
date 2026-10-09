import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'

const state = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), submitSaved: vi.fn(), resolve: vi.fn(), writes: vi.fn(), seed: vi.fn() }))
vi.mock('@/lib/serverActionAuth', () => ({ requireAdminServerAction: state.auth }))
vi.mock('@/lib/intake/loadAdminIntakeRow', () => ({ loadAdminIntakeRow: state.load }))
vi.mock('@/lib/intake/forms/runtime', () => ({ resolveIntakeDelivery: state.resolve, resolveIntakeReadiness: async () => [] }))
vi.mock('@/lib/intake/forms/staffSubmission', () => ({ submitSavedPinnedIntakeRow: state.submitSaved }))
vi.mock('@/lib/intake/linkIntakeToMatter', () => ({ linkIntakeToMatter: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({ ADMIN_EMAIL: 'staff@example.test', getAdminClient: () => ({ from: (table: string) => {
  const chain = {
    select: () => chain, eq: () => chain, like: () => chain,
    maybeSingle: async () => ({ data: table === 'matters' ? { id: 'matter', stage: 'intake', relationship_status: 'hired' } : { id: 'intake', form_version_id: 'pinned' }, error: null }),
    update: (values: unknown) => { state.writes(table, values); return chain },
    insert: (values: unknown) => { state.writes(table, values); return chain },
    delete: () => chain,
    then: (resolve: (value: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve),
  }
  return chain
} }) }))
vi.mock('@/lib/intakeSeed', () => ({ seedDesignSheetAndJobs: state.seed }))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: async (_db: unknown, row: unknown) => row }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getAdminIntakeData, submitAdminIntake, submitSavedPinnedIntake } from '@/app/actions/adminIntake'

beforeEach(() => {
  vi.clearAllMocks()
  state.auth.mockResolvedValue({ userId: 'admin' })
  state.load.mockResolvedValue({ id: 'intake', form_version_id: 'pinned' })
  state.resolve.mockResolvedValue({ rendererMode: 'compiled', compiledForm: { title: 'Pinned form', audience: 'staff' } })
})

describe('staff action boundaries for pinned questionnaires', () => {
  it('authorizes before reading or resolving saved answers', async () => {
    state.auth.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(getAdminIntakeData('intake')).rejects.toThrow('Forbidden')
    expect(state.load).not.toHaveBeenCalled()
    expect(state.resolve).not.toHaveBeenCalled()
  })
  it('resolves a staff-audience pinned form alongside its saved answers', async () => {
    await expect(getAdminIntakeData('intake')).resolves.toMatchObject({ _pinned_form: { audience: 'staff' } })
    expect(state.resolve).toHaveBeenCalledWith({ id: 'intake', form_version_id: 'pinned' }, 'staff', process.env)
  })
  it('keeps unpinned staff editing independent of persistent form availability', async () => {
    state.load.mockResolvedValueOnce({ id: 'intake', form_version_id: null })
    await expect(getAdminIntakeData('intake')).resolves.toEqual({ id: 'intake', form_version_id: null })
    expect(state.resolve).not.toHaveBeenCalled()
  })
  it('authorizes before submitting a saved snapshot', async () => {
    state.auth.mockRejectedValueOnce(new Error('Forbidden'))
    await expect(submitSavedPinnedIntake({ intakeId: 'intake', expectedVersionId: 'pinned' })).rejects.toThrow('Forbidden')
    expect(state.submitSaved).not.toHaveBeenCalled()
  })
  it('prevents the legacy staff submit action from bypassing pinned validation', async () => {
    await expect(submitAdminIntake({ clientIntakeId: 'intake', clientUserId: null, data: emptyAdminIntakeFormData() })).rejects.toThrow('submit the saved pinned questionnaire')
    expect(state.writes).not.toHaveBeenCalled()
  })
})


it('keeps hired-matter progression and drafting seeding after a saved pinned submission', async () => {
  state.submitSaved.mockResolvedValue({ id: 'intake', form_version_id: 'pinned', first_name: 'Ada', last_name: 'Lovelace' })
  await expect(submitSavedPinnedIntake({ intakeId: 'intake', expectedVersionId: 'pinned' })).resolves.toEqual({ id: 'intake' })
  expect(state.submitSaved).toHaveBeenCalledWith(expect.anything(), 'intake', 'pinned')
  expect(state.seed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ intakeId: 'intake', matterId: 'matter' }))
  expect(state.writes).toHaveBeenCalledWith('matters', expect.objectContaining({ stage: 'drafting' }))
  expect(state.writes).toHaveBeenCalledWith('matter_activity', expect.objectContaining({ event_type: 'stage_changed' }))
  const intakeWrites = state.writes.mock.calls.filter(([table]) => table === 'client_intake')
  expect(intakeWrites.every(([, values]) => !Object.hasOwn(values, 'first_name'))).toBe(true)
})
