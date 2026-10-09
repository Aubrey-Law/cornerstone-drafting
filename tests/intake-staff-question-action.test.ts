import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/serverActionAuth', () => ({ requireAdminServerAction: state.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: state.admin }))
vi.mock('@/lib/intake/forms/staffQuestionEditing', () => ({ saveStaffQuestionRow: state.save }))
import { saveAdminIntakeQuestion } from '@/app/actions/adminIntakeQuestion'
it('authorizes staff before obtaining the service client or writing', async () => {
  state.auth.mockRejectedValueOnce(new Error('Forbidden'))
  await expect(saveAdminIntakeQuestion({ intakeId: 'id', expectedVersionId: 'version', expectedUpdatedAt: null, fieldId: 'special_notes', value: 'notes' })).rejects.toThrow('Forbidden')
  expect(state.admin).not.toHaveBeenCalled()
  expect(state.save).not.toHaveBeenCalled()
})
