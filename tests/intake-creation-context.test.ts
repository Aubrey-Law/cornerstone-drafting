import { expect, it, vi } from 'vitest'
import { loadIntakeCreationContext } from '@/lib/intake/creationContext'
function database(data: Record<string, unknown> | null, error: unknown = null) {
  const eq = vi.fn(() => ({ maybeSingle: async () => ({ data, error }) }))
  const from = vi.fn(() => ({ select: () => ({ eq }) }))
  return { admin: { from } as unknown as Parameters<typeof loadIntakeCreationContext>[0], from, eq }
}
it.each(['CP', 'College Preparation Plan', 'College Prep', 'College Prep Plan'])('uses saved matter practice area %s before creation', async practice_area => {
  const { admin, from, eq } = database({ practice_area })
  expect(await loadIntakeCreationContext(admin, { matterId: 'matter', leadId: 'lead' })).toEqual({ practice_area, intake_track: 'college_prep' })
  expect(from).toHaveBeenCalledWith('matter_details')
  expect(eq).toHaveBeenCalledWith('matter_id', 'matter')
})
it('uses lead context and retains an explicit track when practice area is absent', async () => {
  const { admin, from } = database({ practice_area: null, intake_track: 'college_prep' })
  expect(await loadIntakeCreationContext(admin, { leadId: 'lead' })).toEqual({ practice_area: null, intake_track: 'college_prep' })
  expect(from).toHaveBeenCalledWith('client_intake')
})
it('defaults context-free creation to estate without guessing from names', async () => {
  const { admin, from } = database(null)
  expect(await loadIntakeCreationContext(admin, {})).toEqual({ practice_area: null, intake_track: 'estate' })
  expect(from).not.toHaveBeenCalled()
})
it.each([{ matterId: 'matter' }, { leadId: 'lead' }])('fails rather than picking a track after a database error', async source => {
  const { admin } = database(null, new Error('database unavailable'))
  await expect(loadIntakeCreationContext(admin, source)).rejects.toThrow('Unable to determine')
})
it('refuses a missing lead source', async () => {
  const { admin } = database(null)
  await expect(loadIntakeCreationContext(admin, { leadId: 'missing' })).rejects.toThrow('Unable to determine')
})
