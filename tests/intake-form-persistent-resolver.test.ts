import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashIntakeFormDefinition } from '@/lib/intake/forms/hash'
import { IntakeFormUnavailableError, resolveIntakeForm } from '@/lib/intake/forms/resolver'
import type { IntakeFormDefinition } from '@/lib/intake/forms/types'

const database = vi.hoisted(() => ({ read: vi.fn(), templateRead: vi.fn(), filters: [] as [string, unknown][], tables: [] as string[] }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      database.tables.push(table)
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { database.filters.push([column, value]); return query },
        maybeSingle: table === 'intake_form_templates' ? database.templateRead : database.read,
      }
      return query
    },
  }),
}))

function definition(): IntakeFormDefinition {
  return { schemaVersion: 1, key: 'pinned_form', title: 'Pinned questionnaire', sections: [
    { id: 'personal', title: 'Personal', audience: 'client_and_staff', items: [
      { kind: 'field', id: 'name', fieldId: 'client_first_name', labelOverride: 'Pinned first name' },
    ] },
    { id: 'private_section', title: 'Private staff title', subtitle: 'Private staff subtitle', audience: 'staff_only', items: [
      { kind: 'block', id: 'private_item', blockId: 'attorney_plan_structure', titleOverride: 'Private staff item', helpText: 'Private staff help' },
    ] },
    { id: 'review', title: 'Review', audience: 'client_and_staff', items: [
      { kind: 'block', id: 'submit', blockId: 'review_submit' },
    ] },
  ] }
}

function version(status: 'published' | 'retired' | 'draft' = 'published', form = definition()) {
  return {
    id: 'version-1', template_id: 'template-1', version: 1, status, definition: form,
    definition_hash: hashIntakeFormDefinition(form), lock_version: 0, created_by: 'admin-1',
    published_by: status === 'draft' ? null : 'admin-1',
    published_at: status === 'draft' ? null : '2026-10-08T12:00:00Z',
    created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z',
  }
}

beforeEach(() => {
  database.read.mockReset()
  database.read.mockResolvedValue({ data: version(), error: null })
  database.templateRead.mockReset()
  database.templateRead.mockResolvedValue({ data: {
    id: 'template-1', key: 'pinned_form', name: 'Pinned form', description: null, archived_at: null,
    created_by: 'admin-1', created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z',
  }, error: null })
  database.filters.length = 0
  database.tables.length = 0
})

async function expectUnavailable(formVersionId = 'version-1', withTemplate = false) {
  const error = await resolveIntakeForm({ formVersionId, track: 'estate', audience: 'client' }).catch((error: unknown) => error)
  expect(error).toBeInstanceOf(IntakeFormUnavailableError)
  expect(error).toMatchObject({ name: 'IntakeFormUnavailableError', message: 'Pinned intake form version is unavailable' })
  expect(Object.keys(error as object)).toEqual(['name'])
  expect((error as Error).cause).toBeUndefined()
  expect(String(error)).not.toMatch(/Private|secret|SELECT|version-1|definition/)
  expect(database.tables).toEqual(withTemplate ? ['intake_form_versions', 'intake_form_templates'] : ['intake_form_versions'])
  expect(database.filters).toEqual(withTemplate ? [['id', formVersionId], ['id', 'template-1']] : [['id', formVersionId]])
  expect(database.read).toHaveBeenCalledTimes(1)
  expect(database.templateRead).toHaveBeenCalledTimes(withTemplate ? 1 : 0)
}

describe('persistent intake form resolver', () => {
  it.each([
    ['estate', 'client', 'estate', 'Estate Plan Organizer'],
    ['college_prep', 'staff', 'college_prep', 'College Preparation Plan'],
  ] as const)('uses the bundled %s form for a NULL pin without database access', async (track, audience, key, title) => {
    await expect(resolveIntakeForm({ formVersionId: null, track, audience })).resolves.toMatchObject({
      source: 'bundled', versionId: null, form: { key, title, audience },
    })
    expect(database.tables).toEqual([])
    expect(database.read).not.toHaveBeenCalled()
  })

  it('resolves exactly the pinned published version rather than selecting the track or latest version', async () => {
    const result = await resolveIntakeForm({ formVersionId: 'version-1', track: 'college_prep', audience: 'staff' })
    expect(result).toMatchObject({ source: 'persistent', versionId: 'version-1', form: {
      key: 'pinned_form', title: 'Pinned questionnaire', audience: 'staff',
      sections: [
        { id: 'personal', items: [{ kind: 'field', label: 'Pinned first name' }] },
        { id: 'private_section', items: [{ kind: 'block', title: 'Private staff item' }] },
        { id: 'review', items: [{ kind: 'block', blockId: 'review_submit' }] },
      ],
    } })
    expect(database.tables).toEqual(['intake_form_versions', 'intake_form_templates'])
    expect(database.filters).toEqual([['id', 'version-1'], ['id', 'template-1']])
    expect(database.read).toHaveBeenCalledTimes(1)
    expect(result).not.toHaveProperty('definition')
  })

  it('removes staff-only section metadata and items from client delivery', async () => {
    const result = await resolveIntakeForm({ formVersionId: 'version-1', track: 'estate', audience: 'client' })
    expect(result.source).toBe('persistent')
    expect(result.form.audience).toBe('client')
    expect(result.form.sections.map(({ id }) => id)).toEqual(['personal', 'review'])
    expect(JSON.stringify(result)).not.toMatch(/private_section|private_item|Private staff|attorney_plan_structure|staff_only/)
  })

  it('continues resolving a retired pinned version', async () => {
    database.read.mockResolvedValue({ data: version('retired'), error: null })
    await expect(resolveIntakeForm({ formVersionId: 'version-1', track: 'estate', audience: 'client' }))
      .resolves.toMatchObject({ source: 'persistent', versionId: 'version-1', form: { key: 'pinned_form' } })
  })

  it('fails closed for a missing pin', async () => {
    database.read.mockResolvedValue({ data: null, error: null })
    await expectUnavailable('missing')
  })

  it('does not treat an empty non-null ID as a legacy pin', async () => {
    database.read.mockResolvedValue({ data: null, error: null })
    await expectUnavailable('')
  })

  it('rejects draft versions', async () => {
    database.read.mockResolvedValue({ data: version('draft'), error: null })
    await expectUnavailable()
  })

  it('rejects a hash-valid definition whose identity differs from its owning template', async () => {
    const form = definition()
    form.key = 'other_form'
    database.read.mockResolvedValue({ data: version('published', form), error: null })
    await expectUnavailable('version-1', true)
  })

  it('rejects a missing owning template', async () => {
    database.templateRead.mockResolvedValue({ data: null, error: null })
    await expectUnavailable('version-1', true)
  })

  it('sanitizes an invalid owning-template record', async () => {
    database.templateRead.mockResolvedValue({ data: { id: 'template-1', key: 'pinned_form', secret: 'Private template' }, error: null })
    await expectUnavailable('version-1', true)
  })

  it('sanitizes owning-template database failures', async () => {
    database.templateRead.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'SELECT secret FROM Private template' } })
    await expectUnavailable('version-1', true)
  })

  it('sanitizes a structurally invalid stored definition', async () => {
    database.read.mockResolvedValue({ data: { ...version(), definition: { schemaVersion: 1, secret: 'Private stored definition' } }, error: null })
    await expectUnavailable()
  })

  it('fails closed when a stored definition no longer matches its hash', async () => {
    database.read.mockResolvedValue({ data: { ...version(), definition_hash: '0'.repeat(64) }, error: null })
    await expectUnavailable()
  })

  it('sanitizes compilation diagnostics for a structurally valid but incomplete form', async () => {
    const form = definition()
    form.sections = form.sections.filter(({ id }) => id !== 'review')
    database.read.mockResolvedValue({ data: version('published', form), error: null })
    await expectUnavailable('version-1', true)
  })

  it('sanitizes database failures without retaining their details or cause', async () => {
    database.read.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'SELECT secret FROM Private stored definition', details: 'secret' } })
    await expectUnavailable()
  })

  it('sanitizes unexpected repository exceptions', async () => {
    database.read.mockRejectedValue(new Error('Private secret definition'))
    await expectUnavailable()
  })
})

function resolverReferences(filename: string, contents: string): string[] {
  const violations: string[] = []
  const source = ts.createSourceFile(filename, contents, ts.ScriptTarget.Latest, true)
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) {
      const modulePath = node.text.startsWith('@/') ? path.resolve(node.text.slice(2))
        : node.text.startsWith('.') ? path.resolve(path.dirname(filename), node.text) : null
      if (modulePath?.replace(/\.[cm]?[jt]s$/, '') === path.resolve('lib/intake/forms/resolver')) {
        violations.push(path.relative(process.cwd(), filename))
      }
    }
    if (ts.isIdentifier(node) && node.text === 'resolveIntakeForm') violations.push(path.relative(process.cwd(), filename))
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

describe('persistent rendering remains dormant', () => {
  it.each([
    "import { resolveIntakeForm as load } from '@/lib/intake/forms/resolver'; export const wrapped = load",
    "export { resolveIntakeForm as load } from './forms/resolver'",
    "export * from '@/lib/intake/forms/resolver'",
    "const form = import('./forms/resolver.ts')",
    "const form = require('@/lib/intake/forms/resolver')",
  ])('detects indirect or renamed resolver use in a runtime helper: %s', (contents) => {
    expect(resolverReferences(path.resolve('lib/intake/helper.ts'), contents)).toContain('lib/intake/helper.ts')
  })

  it('has no resolver imports in current pages, intake/public routes, or intake components', () => {
    function sourceFiles(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filename = path.join(directory, entry.name)
        return entry.isDirectory() ? sourceFiles(filename) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [filename] : []
      })
    }
    const files = ['app', 'components', 'lib', 'hooks'].flatMap((root) => sourceFiles(path.resolve(root)))
      .filter((filename) => filename !== path.resolve('lib/intake/forms/resolver.ts'))
    expect(files).toContain(path.resolve('components/intake/SchemaDrivenGuidedInterview.tsx'))
    expect(files).toContain(path.resolve('app/intake/(shell)/page.tsx'))
    expect(files).toContain(path.resolve('app/api/intake/route.ts'))
    expect(files).toContain(path.resolve('lib/intake/getOrCreateClientIntake.ts'))
    expect(files).toContain(path.resolve('components/AdminIntakeSheet.tsx'))
    const violations = files.flatMap((filename) => resolverReferences(filename, readFileSync(filename, 'utf8')))
    expect(violations).toEqual([])
  })
})
