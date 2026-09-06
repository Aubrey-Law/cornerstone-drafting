import { describe, expect, it } from 'vitest'
import { toPublishedPrompt, loadPublishedPrompt, loadPublishedPrompts } from '@/lib/prompts/repository'

const reviewBody = {
  kind: 'review' as const,
  inputs: [],
  rules: [{ number: '1', statement: 'Our exculpation language carves out gross negligence.', risk: 'high' as const }],
}

const versionRow = (over: Partial<Parameters<typeof toPublishedPrompt>[0]> = {}) => ({
  id: 'version-1',
  version_number: 3,
  body: reviewBody,
  prompt_id: 'prompt-1',
  prompts: { slug: 'ma-trust-firm-qa', title: 'MA trust firm QA', kind: 'review' },
  ...over,
})

const FIELD_AUDIT_CHECK = {
  number: '1',
  statement: 'Every stated concern is answered.',
  risk: 'blocker' as const,
  reads: ['x'],
  taskTemplate: { title: 't', description: 'd', priority: 'high' as const },
}

/**
 * `toPublishedPrompt` is the pure half — validated directly against plain
 * objects, no database involved.
 */
describe('toPublishedPrompt', () => {
  it('parses a valid row into a PublishedPrompt', () => {
    const prompt = toPublishedPrompt(versionRow())
    expect(prompt).toEqual({
      versionId: 'version-1',
      promptId: 'prompt-1',
      versionNumber: 3,
      slug: 'ma-trust-firm-qa',
      title: 'MA trust firm QA',
      body: reviewBody,
    })
  })

  /**
   * The composite foreign key on prompt_versions stops a version from
   * claiming a kind its prompt doesn't have, but it says nothing about the
   * body itself — a review prompt's version could still carry a body whose
   * own `kind` says `field_audit`. That mismatch has to be caught here.
   */
  it('throws when the body’s kind disagrees with the prompt’s kind', () => {
    const row = versionRow({ prompts: { slug: 'ma-trust-firm-qa', title: 'MA trust firm QA', kind: 'field_audit' } })
    expect(() => toPublishedPrompt(row)).toThrow(/ma-trust-firm-qa/)
    expect(() => toPublishedPrompt(row)).toThrow(/field_audit/)
  })

  /**
   * `body` is jsonb: nothing in Postgres stops a hand-run UPDATE from putting
   * the wrong shape into an already-published row. A prompt that silently
   * skipped a rule because of that is the failure this product cannot have,
   * so the shape is checked again here, not only at publish time.
   */
  it('throws naming the slug when the body fails the schema', () => {
    const row = versionRow({ body: { kind: 'review', inputs: [], rules: [] } })
    expect(() => toPublishedPrompt(row)).toThrow(/ma-trust-firm-qa/)
  })

  it('still names the version id when the row has no prompt to blame', () => {
    const row = versionRow({ body: { kind: 'review', inputs: [], rules: [] }, prompts: null })
    expect(() => toPublishedPrompt(row)).toThrow(/version-1/)
  })

  /**
   * The withdrawal rule scopes candidates by prompt, and the only way it can
   * know this run's prompt is off the loaded version. `prompt_id` was always
   * read by both loaders and never exposed.
   */
  it('carries the prompt id, not only the version id', () => {
    const prompt = toPublishedPrompt({
      id: 'version-1',
      version_number: 4,
      body: {
        kind: 'field_audit',
        inputs: [{ key: 'x', source: 'design_sheet.concerns', required: true }],
        checks: [FIELD_AUDIT_CHECK],
        outputTarget: 'checklist',
      },
      prompt_id: 'prompt-1',
      prompts: { slug: 'ma-design-sheet-audit', title: 'MA design sheet audit', kind: 'field_audit' },
    })
    expect(prompt.promptId).toBe('prompt-1')
    expect(prompt.versionId).toBe('version-1')
  })
})

/**
 * A narrow, hand-built fake of the one shape each function touches — the
 * same idiom `apps/workbench/tests/supabase-clients.test.ts` uses for
 * `readUserRole`, chosen so this test does not need a real database or a
 * mocked module.
 */
function fakeClient(tables: Record<string, unknown[]>) {
  return {
    from: (table: string) => {
      const rows = tables[table] ?? []
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          const match = rows.find((row) => (row as Record<string, unknown>)[column] === value)
          return {
            maybeSingle: async () => ({ data: match ?? null, error: null }),
          }
        },
        in: (column: string, values: unknown[]) => {
          const matches = rows.filter((row) => values.includes((row as Record<string, unknown>)[column]))
          return Promise.resolve({ data: matches, error: null })
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      }
      return builder
    },
    // The narrow shape above is all loadPublishedPrompt/loadPublishedPrompts touch.
  } as never
}

describe('loadPublishedPrompt', () => {
  it('finds the prompt, its publication, then that version', async () => {
    const client = fakeClient({
      prompts: [{ id: 'p-1', slug: 'ma-trust-firm-qa', title: 'MA trust firm QA', kind: 'review' }],
      prompt_publications: [{ prompt_id: 'p-1', version_id: 'v-1' }],
      prompt_versions: [{ id: 'v-1', version_number: 2, body: reviewBody, prompt_id: 'p-1' }],
    })
    const prompt = await loadPublishedPrompt(client, 'ma-trust-firm-qa')
    expect(prompt).toEqual({
      versionId: 'v-1',
      promptId: 'p-1',
      versionNumber: 2,
      slug: 'ma-trust-firm-qa',
      title: 'MA trust firm QA',
      body: reviewBody,
    })
  })

  it('returns null for a prompt that does not exist', async () => {
    const client = fakeClient({ prompts: [], prompt_publications: [], prompt_versions: [] })
    expect(await loadPublishedPrompt(client, 'not-a-slug')).toBeNull()
  })

  it('returns null for a prompt that exists but has never been published', async () => {
    const client = fakeClient({
      prompts: [{ id: 'p-1', slug: 'ma-trust-firm-qa', title: 'MA trust firm QA', kind: 'review' }],
      prompt_publications: [],
      prompt_versions: [],
    })
    expect(await loadPublishedPrompt(client, 'ma-trust-firm-qa')).toBeNull()
  })
})

describe('loadPublishedPrompts', () => {
  it('loads every prompt that has a publication', async () => {
    const client = fakeClient({
      prompts: [
        { id: 'p-1', slug: 'ma-trust-firm-qa', title: 'MA trust firm QA', kind: 'review' },
        { id: 'p-2', slug: 'field-audit', title: 'Field audit', kind: 'field_audit' },
      ],
      prompt_publications: [
        { prompt_id: 'p-1', version_id: 'v-1' },
        { prompt_id: 'p-2', version_id: 'v-2' },
      ],
      prompt_versions: [
        { id: 'v-1', version_number: 1, body: reviewBody },
        {
          id: 'v-2',
          version_number: 1,
          body: {
            kind: 'field_audit',
            inputs: [{ key: 'x', source: 'design_sheet.concerns', required: true }],
            checks: [
              {
                number: '1',
                statement: 'Every stated concern is answered.',
                risk: 'blocker',
                reads: ['x'],
                taskTemplate: { title: 't', description: 'd', priority: 'high' },
              },
            ],
          },
        },
      ],
    })
    const prompts = await loadPublishedPrompts(client)
    expect(prompts.map((p) => p.slug).sort()).toEqual(['field-audit', 'ma-trust-firm-qa'])
  })

  it('returns an empty list when nothing is published', async () => {
    const client = fakeClient({ prompt_publications: [] })
    expect(await loadPublishedPrompts(client)).toEqual([])
  })
})
