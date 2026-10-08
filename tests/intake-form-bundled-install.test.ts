import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COLLEGE_PREP_INTAKE_FORM, ESTATE_INTAKE_FORM } from '@/lib/intake/forms/definitions'
import * as compiler from '@/lib/intake/forms/compiler'
import type { IntakeFormTemplateRow, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
import * as repository from '@/lib/intake/forms/repository'
import {
  buildBundledIntakeFormInstallPlan, parseBundledIntakeFormInstallArgs, runBundledIntakeFormInstall,
  type ExistingBundledIntakeForm,
} from '@/scripts/installBundledIntakeForms'

vi.mock('@/lib/intake/forms/repository', () => ({
  listTemplateRows: vi.fn(), listVersionRows: vi.fn(), getVersionRow: vi.fn(), getTemplateRow: vi.fn(), getDraftRow: vi.fn(),
  createTemplateRow: vi.fn(), publishDraftRow: vi.fn(),
}))

const ACTOR = '10000000-0000-4000-8000-000000000001'
const HASHES = {
  estate: '4cea350d23fe6b2e0a003131ed2648dd77d1bdb6582a55ed42d83d2e473ee319',
  college_prep: '4b0f24336186bf0aa3a2c0cb8c80647b081f3fd0c1aee60ac6303980b319b7e2',
}
const NOW = '2026-10-08T12:00:00Z'
function existing(key: 'estate' | 'college_prep'): ExistingBundledIntakeForm {
  const definition = key === 'estate' ? ESTATE_INTAKE_FORM : COLLEGE_PREP_INTAKE_FORM
  const template: IntakeFormTemplateRow = {
    id: `${key}-template`, key, name: definition.title, description: null, archived_at: null,
    created_by: ACTOR, created_at: NOW, updated_at: NOW,
  }
  const version: IntakeFormVersionRow = {
    id: `${key}-version`, template_id: template.id, version: 1, status: 'published',
    definition: structuredClone(definition), definition_hash: HASHES[key], lock_version: 0,
    created_by: ACTOR, published_by: ACTOR, created_at: NOW, updated_at: NOW, published_at: NOW,
  }
  return { template, versions: [version] }
}

describe('bundled intake form install planner', () => {
  it('plans both version-one publications with stable canonical hashes without mutating its inputs', () => {
    const before = structuredClone([ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM])
    expect(buildBundledIntakeFormInstallPlan([]).map(({ key, action, definitionHash }) => ({ key, action, definitionHash })))
      .toEqual([
        { key: 'estate', action: 'create_and_publish', definitionHash: HASHES.estate },
        { key: 'college_prep', action: 'create_and_publish', definitionHash: HASHES.college_prep },
      ])
    expect([ESTATE_INTAKE_FORM, COLLEGE_PREP_INTAKE_FORM]).toEqual(before)
  })

  it('returns exactly two no-ops for matching publications', () => {
    const rows = [existing('college_prep'), existing('estate')]
    const before = structuredClone(rows)
    expect(buildBundledIntakeFormInstallPlan(rows).map(({ action }) => action)).toEqual(['noop', 'noop'])
    expect(rows).toEqual(before)
  })

  it('aborts the complete plan when a later bundled publication has hash drift', () => {
    const college = existing('college_prep')
    college.versions[0].definition_hash = '0'.repeat(64)
    expect(() => buildBundledIntakeFormInstallPlan([college])).toThrow(
      'Published bundled form differs; create and review a new draft explicitly',
    )
  })

  it.each(['no_versions', 'draft', 'retired', 'next_version', 'extra_draft', 'archived', 'wrong_template', 'wrong_key', 'corrupt_hash', 'duplicate_template'])
    ('rejects inconsistent existing state: %s', (state) => {
      const row = existing('college_prep')
      if (state === 'no_versions') row.versions = []
      if (state === 'draft') Object.assign(row.versions[0], { status: 'draft', published_at: null, published_by: null })
      if (state === 'retired') row.versions[0].status = 'retired'
      if (state === 'next_version') row.versions[0].version = 2
      if (state === 'extra_draft') row.versions.push({ ...row.versions[0], id: 'draft', version: 2, status: 'draft', published_at: null, published_by: null })
      if (state === 'archived') row.template.archived_at = NOW
      if (state === 'wrong_template') row.versions[0].template_id = 'unrelated'
      if (state === 'wrong_key') row.versions[0].definition.key = 'unrelated'
      if (state === 'corrupt_hash') row.versions[0].definition.title = 'Corrupted stored definition'
      expect(() => buildBundledIntakeFormInstallPlan(state === 'duplicate_template' ? [row, row] : [row]))
        .toThrow('Bundled form installation state is inconsistent')
    })

  it('leaves unrelated templates out of the plan and can complete one absent bundle', () => {
    const unrelated = existing('college_prep')
    unrelated.template.key = 'custom'
    expect(buildBundledIntakeFormInstallPlan([existing('estate'), unrelated]).map(({ action }) => action))
      .toEqual(['noop', 'create_and_publish'])
  })
})

describe('bundled installer command', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('defaults to dry-run and requires an explicit UUID actor only for apply', () => {
    expect(parseBundledIntakeFormInstallArgs([])).toEqual({ apply: false })
    expect(parseBundledIntakeFormInstallArgs(['--dry-run'])).toEqual({ apply: false })
    expect(parseBundledIntakeFormInstallArgs(['--apply', '--actor-id', ACTOR])).toEqual({ apply: true, actorId: ACTOR })
    expect(() => parseBundledIntakeFormInstallArgs(['--apply'])).toThrow('Apply requires an explicit UUID --actor-id')
    expect(() => parseBundledIntakeFormInstallArgs(['--apply', '--actor-id', 'admin'])).toThrow('actor-id must be a UUID')
    expect(() => parseBundledIntakeFormInstallArgs(['--actor-id', ''])).toThrow('actor-id must be a UUID')
    expect(() => parseBundledIntakeFormInstallArgs(['--apply', '--dry-run', '--actor-id', ACTOR])).toThrow('Choose either --dry-run or --apply')
    expect(() => parseBundledIntakeFormInstallArgs(['--force'])).toThrow('Unknown installer argument')
    expect(() => parseBundledIntakeFormInstallArgs(['--actor-id', ACTOR, '--actor-id', ACTOR])).toThrow('Duplicate installer argument')
  })

  it('compiles both fixtures for client and staff before the first database read, and dry-run never writes', async () => {
    const calls: string[] = []
    const actualCompile = compiler.compileIntakeForm
    const spy = vi.spyOn(compiler, 'compileIntakeForm').mockImplementation((definition, audience) => {
      calls.push(`${(definition as { key: string }).key}:${audience}`)
      return actualCompile(definition, audience)
    })
    vi.mocked(repository.listTemplateRows).mockImplementation(async () => {
      expect(calls).toEqual(['estate:client', 'estate:staff', 'college_prep:client', 'college_prep:staff'])
      return []
    })
    try {
      expect((await runBundledIntakeFormInstall({ apply: false })).map(({ action }) => action))
        .toEqual(['create_and_publish', 'create_and_publish'])
      expect(repository.createTemplateRow).not.toHaveBeenCalled()
      expect(repository.publishDraftRow).not.toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })

  it('invalid bundled compilation aborts without any database calls', async () => {
    const sections = COLLEGE_PREP_INTAKE_FORM.sections
    COLLEGE_PREP_INTAKE_FORM.sections = sections.filter(({ id }) => id !== 'review')
    try {
      await expect(runBundledIntakeFormInstall({ apply: true, actorId: ACTOR })).rejects.toThrow('Invalid bundled intake form college_prep')
      expect(repository.listTemplateRows).not.toHaveBeenCalled()
      expect(repository.createTemplateRow).not.toHaveBeenCalled()
    } finally { COLLEGE_PREP_INTAKE_FORM.sections = sections }
  })

  it('rejects an invalid apply actor even when called outside the CLI', async () => {
    await expect(runBundledIntakeFormInstall({ apply: true })).rejects.toThrow('Apply requires an explicit UUID --actor-id')
    await expect(runBundledIntakeFormInstall({ apply: true, actorId: 'admin' })).rejects.toThrow('actor-id must be a UUID')
    expect(repository.listTemplateRows).not.toHaveBeenCalled()
  })

  it('checks all persisted bundles before writing when the second bundle differs', async () => {
    const college = existing('college_prep')
    college.versions[0].definition_hash = '0'.repeat(64)
    vi.mocked(repository.listTemplateRows).mockResolvedValue([college.template])
    vi.mocked(repository.listVersionRows).mockResolvedValue(college.versions)
    await expect(runBundledIntakeFormInstall({ apply: true, actorId: ACTOR })).rejects.toThrow('Published bundled form differs')
    expect(repository.createTemplateRow).not.toHaveBeenCalled()
    expect(repository.publishDraftRow).not.toHaveBeenCalled()
  })

  it('uses the real lifecycle service to publish version one, then reruns as exactly two no-ops', async () => {
    const stored: ExistingBundledIntakeForm[] = []
    vi.mocked(repository.listTemplateRows).mockImplementation(async () => stored.map(({ template }) => template))
    vi.mocked(repository.listVersionRows).mockImplementation(async (id) => stored.find(({ template }) => template.id === id)!.versions)
    vi.mocked(repository.getVersionRow).mockImplementation(async (id) => stored.flatMap(({ versions }) => versions).find((version) => version.id === id) ?? null)
    vi.mocked(repository.createTemplateRow).mockImplementation(async (input) => {
      expect(input.actorId).toBe(ACTOR)
      expect(input.definitionHash).toBe(HASHES[input.key as keyof typeof HASHES])
      const row = existing(input.key as keyof typeof HASHES)
      Object.assign(row.versions[0], { status: 'draft', published_at: null, published_by: null, definition: input.definition })
      stored.push(row)
      return { template: row.template, draft: row.versions[0] }
    })
    vi.mocked(repository.publishDraftRow).mockImplementation(async (input) => {
      const version = stored.flatMap(({ versions }) => versions).find(({ id }) => id === input.versionId)!
      expect(input).toEqual({ actorId: ACTOR, versionId: version.id, expectedLockVersion: 0, expectedDefinitionHash: version.definition_hash })
      Object.assign(version, { status: 'published', published_by: ACTOR, published_at: NOW })
      return version
    })
    expect((await runBundledIntakeFormInstall({ apply: true, actorId: ACTOR })).map(({ action }) => action))
      .toEqual(['create_and_publish', 'create_and_publish'])
    expect(stored.flatMap(({ versions }) => versions).map(({ version, status }) => ({ version, status })))
      .toEqual([{ version: 1, status: 'published' }, { version: 1, status: 'published' }])
    expect((await runBundledIntakeFormInstall({ apply: true, actorId: ACTOR })).map(({ action }) => action)).toEqual(['noop', 'noop'])
    expect(repository.createTemplateRow).toHaveBeenCalledTimes(2)
    expect(repository.publishDraftRow).toHaveBeenCalledTimes(2)
    expect(stored).toHaveLength(2)
  })
})
