import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntakeSubmissionValidator, resolveIntakeDelivery } from '@/lib/intake/forms/runtime'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

const repository = vi.hoisted(() => ({ version: vi.fn(), template: vi.fn() }))
vi.mock('@/lib/intake/forms/repository', () => ({ getVersionRow: repository.version, getTemplateRow: repository.template }))

const definition: IntakeFormDefinition = { schemaVersion: 1, key: 'custom_form', title: 'Published custom form', sections: [
  { id: 'custom_identity', title: 'Your identity', audience: 'client_and_staff', items: [
    { kind: 'field', id: 'first', fieldId: 'client_first_name' },
  ] },
  { id: 'private', title: 'Staff only', audience: 'staff_only', items: [
    { kind: 'block', id: 'private_plan', blockId: 'attorney_plan_structure' },
  ] },
  { id: 'review', title: 'Review', audience: 'client_and_staff', items: [{ kind: 'block', id: 'submit', blockId: 'review_submit' }] },
] }
const row = { form_version_id: 'pinned-1', intake_track: 'college_prep' }

beforeEach(() => {
  repository.version.mockReset().mockResolvedValue({ id: 'pinned-1', template_id: 'template-1', status: 'published', definition })
  repository.template.mockReset().mockResolvedValue({ id: 'template-1', key: definition.key, archived_at: null })
})

describe('authorized intake form runtime', () => {
  it.each(['legacy', 'compiled'])('honors the exact pin in %s mode and filters client delivery', async mode => {
    const delivery = await resolveIntakeDelivery(row, 'client', { INTAKE_RENDERER_MODE: mode })
    expect(delivery).toMatchObject({ rendererMode: 'compiled', compiledForm: { title: definition.title } })
    expect(JSON.stringify(delivery)).not.toContain('Staff only')
    expect(repository.version).toHaveBeenCalledWith('pinned-1')
  })

  it('delivers staff content only when the authorized caller requests staff audience', async () => {
    const delivery = await resolveIntakeDelivery(row, 'staff', {})
    expect(JSON.stringify(delivery)).toContain('Staff only')
  })

  it('allows retired pins on archived templates', async () => {
    repository.version.mockResolvedValue({ template_id: 'template-1', status: 'retired', definition })
    repository.template.mockResolvedValue({ key: definition.key, archived_at: '2026-10-09' })
    await expect(resolveIntakeDelivery(row, 'client', {})).resolves.toMatchObject({ rendererMode: 'compiled' })
  })

  it.each(['missing', 'draft', 'database failure'])('fails closed for %s pins even in rollback', async failure => {
    if (failure === 'database failure') repository.version.mockRejectedValue(new Error('private database detail'))
    else repository.version.mockResolvedValue(failure === 'missing' ? null : { status: 'draft' })
    await expect(resolveIntakeDelivery(row, 'client', { INTAKE_RENDERER_MODE: 'legacy' })).rejects.toThrow('Pinned intake form version is unavailable')
  })

  it.each(['', 7, false, {}])('rejects malformed stored pins (%s)', async pin => {
    await expect(resolveIntakeDelivery({ form_version_id: pin }, 'client', {})).rejects.toThrow('Intake form is unavailable')
    expect(repository.version).not.toHaveBeenCalled()
  })

  it.each(['estate', 'college_prep'])('preserves both unpinned %s rollout modes without database reads', async track => {
    const legacy = { form_version_id: null, intake_track: track }
    await expect(resolveIntakeDelivery(legacy, 'client', {})).resolves.toEqual({ rendererMode: 'legacy' })
    await expect(resolveIntakeDelivery(legacy, 'client', { INTAKE_RENDERER_MODE: 'compiled' })).resolves.toMatchObject({ rendererMode: 'compiled', compiledForm: { key: track } })
    expect(repository.version).not.toHaveBeenCalled()
  })

  it.each(['legacy', 'compiled'])('validates the delivered definition and trusted track in %s mode', async mode => {
    const validate = await createIntakeSubmissionValidator({ INTAKE_RENDERER_MODE: mode })
    const errors = await validate(row, { form_version_id: 'attacker-version', intake_track: 'estate' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ sectionId: 'custom_identity', message: "Enter the student's first name." })
    expect(repository.version).toHaveBeenCalledWith('pinned-1')
    // This custom form requires only the first name, unlike the bundled form.
    await expect(validate(row, { first_name: 'Jordan' })).resolves.toEqual([])
  })

  it('ignores request pins on legacy rows and retains bundled validation', async () => {
    const validate = await createIntakeSubmissionValidator({ INTAKE_RENDERER_MODE: 'compiled' })
    const errors = await validate({ form_version_id: null, intake_track: 'estate' }, { first_name: 'Jordan', form_version_id: 'attacker-version' })
    expect(errors.length).toBeGreaterThan(0)
    expect(repository.version).not.toHaveBeenCalled()
  })
})
