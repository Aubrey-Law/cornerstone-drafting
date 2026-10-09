import { beforeEach, expect, it, vi } from 'vitest'
import { emptyAdminIntakeFormData } from '@/types/adminIntake'
const state = vi.hoisted(() => ({ context: vi.fn(), insert: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/serverActionAuth', () => ({ requireAdminServerAction: state.auth }))
vi.mock('@/lib/intake/creationContext', () => ({ loadIntakeCreationContext: state.context }))
vi.mock('@/lib/supabaseAdmin', () => ({ ADMIN_EMAIL: 'staff@example.test', getAdminClient: () => ({ from: (table: string) => {
  const chain = {
    select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: table === 'matters' ? { id: 'matter', client_id: 'client', client_intake_id: null } : null, error: null }),
    insert: (payload: unknown) => { state.insert(payload); return chain },
    // Stop after observing the real action's insert; downstream answer/contact
    // persistence is covered elsewhere and is irrelevant to initial identity.
    single: async () => ({ data: null, error: { message: 'insert boundary reached' } }),
  }
  return chain
} }) }))
import { saveAdminIntakeDraft } from '@/app/actions/adminIntake'
beforeEach(() => {
  vi.clearAllMocks()
  state.auth.mockResolvedValue({ userId: 'admin' })
  state.context.mockResolvedValue({ practice_area: 'CP', intake_track: 'college_prep' })
})
it.each([{ matterId: 'matter' }, { leadId: 'lead' }])('passes saved context into the first insert for %j', async source => {
  await expect(saveAdminIntakeDraft({ ...source, clientIntakeId: null, clientUserId: 'client', data: emptyAdminIntakeFormData() })).rejects.toThrow('insert boundary reached')
  expect(state.context).toHaveBeenCalledWith(expect.anything(), source)
  expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ practice_area: 'CP', intake_track: 'college_prep' }))
  expect(state.insert.mock.calls[0][0]).not.toHaveProperty('form_version_id')
})
it('does not create a guessed questionnaire if context cannot be loaded', async () => {
  state.context.mockRejectedValue(new Error('context unavailable'))
  await expect(saveAdminIntakeDraft({ matterId: 'matter', clientIntakeId: null, clientUserId: 'client', data: emptyAdminIntakeFormData() })).rejects.toThrow('context unavailable')
  expect(state.insert).not.toHaveBeenCalled()
})
