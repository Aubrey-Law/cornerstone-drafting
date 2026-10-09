import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitSavedPinnedIntakeRow } from '@/lib/intake/forms/staffSubmission'

const state = vi.hoisted(() => ({ hydrate: vi.fn(), version: vi.fn() }))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: state.hydrate }))
vi.mock('@/lib/intake/forms/repository', () => ({ getVersionRow: state.version, getTemplateRow: async () => ({ key: 'custom_form' }) }))

const definition = { schemaVersion: 1, key: 'custom_form', title: 'Custom form', sections: [
  { id: 'identity', title: 'Identity', audience: 'client_and_staff', items: [{ kind: 'field', id: 'name', fieldId: 'client_first_name' }] },
  { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] }
function database(overrides: Record<string, unknown> = {}, conflict = false) {
  const row = { id: 'intake', form_version_id: 'version', intake_track: 'college_prep', status: 'draft', updated_at: '2026-10-09T12:00:00Z', first_name: 'Jordan', custom_answer: 'Preserve me', ...overrides }
  const writes: Record<string, unknown>[] = []
  const filters: [string, unknown][] = []
  const client = { from: () => {
    let updating = false
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { if (updating) filters.push([key, value]); return chain },
      is: (key: string, value: unknown) => { if (updating) filters.push([key, value]); return chain },
      update: (payload: Record<string, unknown>) => { updating = true; writes.push(payload); return chain },
      maybeSingle: async () => ({ data: updating ? conflict ? null : { id: 'intake' } : row, error: null }),
    }
    return chain
  } }
  return { row, writes, filters, client: client as unknown as Parameters<typeof submitSavedPinnedIntakeRow>[0] }
}
beforeEach(() => {
  state.hydrate.mockReset().mockImplementation(async (_db, row) => row)
  state.version.mockReset().mockResolvedValue({ template_id: 'template', status: 'published', definition })
})

describe('staff submission of saved pinned answers', () => {
  it('validates saved client answers and writes only completion state with snapshot guards', async () => {
    const db = database()
    const result = await submitSavedPinnedIntakeRow(db.client, 'intake', 'version')
    expect(result.custom_answer).toBe('Preserve me')
    expect(db.writes).toEqual([{ status: 'submitted', intake_completed_at: expect.any(String) }])
    expect(db.filters).toEqual([['id', 'intake'], ['form_version_id', 'version'], ['updated_at', db.row.updated_at], ['status', 'draft']])
  })
  it('rejects missing required answers without completion or answer writes', async () => {
    const db = database({ first_name: null })
    await expect(submitSavedPinnedIntakeRow(db.client, 'intake', 'version')).rejects.toThrow("Enter the student's first name")
    expect(db.writes).toEqual([])
  })
  it.each([null, 'other'])('rejects an absent or changed stored pin (%s)', async pin => {
    const db = database({ form_version_id: pin })
    await expect(submitSavedPinnedIntakeRow(db.client, 'intake', 'version')).rejects.toThrow('version has changed')
    expect(db.writes).toEqual([])
    expect(state.version).not.toHaveBeenCalled()
  })
  it.each(['submitted', 'approved'])('preserves the %s lock', async status => {
    const db = database({ status })
    await expect(submitSavedPinnedIntakeRow(db.client, 'intake', 'version')).rejects.toThrow('already been submitted')
    expect(db.writes).toEqual([])
  })
  it('fails closed when the pinned form is unavailable', async () => {
    state.version.mockResolvedValue(null)
    const db = database()
    await expect(submitSavedPinnedIntakeRow(db.client, 'intake', 'version')).rejects.toThrow('pinned questionnaire is unavailable')
    expect(db.writes).toEqual([])
  })
  it('does not report success when the row changes during validation', async () => {
    const db = database({}, true)
    await expect(submitSavedPinnedIntakeRow(db.client, 'intake', 'version')).rejects.toThrow('saved intake changed')
  })
  it('uses hydrated contact answers and leaves them untouched', async () => {
    const db = database({ first_name: null })
    state.hydrate.mockResolvedValue({ ...db.row, first_name: 'Hydrated name', _children: [{ first_name: 'Child' }] })
    await expect(submitSavedPinnedIntakeRow(db.client, 'intake', 'version')).resolves.toMatchObject({ first_name: 'Hydrated name' })
    expect(db.writes[0]).not.toHaveProperty('first_name')
    expect(db.writes[0]).not.toHaveProperty('_children')
  })
})
