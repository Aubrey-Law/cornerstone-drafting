import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { promptBodySchema } from '@aubrey-law/citations/prompt/body'
import { buildReviewBody, contentHashFor, publishReviewPlaybook } from '@/lib/playbooks/publish'
import { SLUG_PATTERN, slugFromTitle } from '@/lib/playbooks/slug'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { makeFakeClient } from './helpers/fakeSupabase'

const asClient = (fake: ReturnType<typeof makeFakeClient>) =>
  fake as unknown as SupabaseClient<WorkbenchDatabase>

const RULES = [
  { statement: '  Our bond waiver runs only to named trustees.  ', risk: 'medium' as const, preferredLanguage: '' },
  { statement: 'Every discretionary standard says whether other resources count.', risk: 'blocker' as const, preferredLanguage: 'considering other resources' },
]

describe('slugFromTitle', () => {
  it('makes an id the pattern accepts', () => {
    const slug = slugFromTitle('Massachusetts Durable POA — firm quality review!')
    expect(slug).toBe('massachusetts-durable-poa-firm-quality-review')
    expect(SLUG_PATTERN.test(slug)).toBe(true)
  })
})

describe('buildReviewBody', () => {
  it('renumbers in order, trims, and omits empty preferred language', () => {
    const body = buildReviewBody(RULES)
    expect(body.rules).toEqual([
      { number: '1', risk: 'medium', statement: 'Our bond waiver runs only to named trustees.' },
      {
        number: '2',
        risk: 'blocker',
        statement: 'Every discretionary standard says whether other resources count.',
        preferredLanguage: 'considering other resources',
      },
    ])
    // What a read will re-validate with `toPublishedPrompt`.
    expect(promptBodySchema.safeParse(body).success).toBe(true)
  })

  it('refuses a blank statement before anything is written', () => {
    expect(() => buildReviewBody([{ statement: '   ', risk: 'low' }])).toThrow()
  })

  it('hashes the body the way the seeded version was hashed', () => {
    const body = buildReviewBody(RULES)
    expect(contentHashFor(body)).toBe(crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'))
    expect(contentHashFor(body)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('publishReviewPlaybook', () => {
  it('creates a new playbook at version 1 and publishes it', async () => {
    const fake = makeFakeClient()
    const result = await publishReviewPlaybook(asClient(fake), {
      slug: 'ma-dpoa-firm-qa',
      title: 'MA DPOA — firm review',
      rules: RULES,
      changeSummary: 'Built from precedent.docx.',
      userId: 'user-1',
    })
    expect(result).toEqual({ ok: true, slug: 'ma-dpoa-firm-qa', versionNumber: 1, ruleCount: 2 })

    const loaded = await loadPublishedPrompt(asClient(fake), 'ma-dpoa-firm-qa')
    expect(loaded?.versionNumber).toBe(1)
    expect(loaded?.body.kind).toBe('review')
    expect(fake.tableRows('prompts')[0]).toMatchObject({ kind: 'review', is_system: false })
  })

  it('adds the next version to an existing playbook and moves the publication, leaving the old version', async () => {
    const fake = makeFakeClient({
      prompts: [{ id: 'p-trust', slug: 'ma-trust-firm-qa', title: 'Trust review', kind: 'review' }],
      prompt_versions: [
        { id: 'v1', prompt_id: 'p-trust', kind: 'review', version_number: 1, body: buildReviewBody(RULES.slice(0, 1)) },
      ],
      prompt_publications: [{ prompt_id: 'p-trust', version_id: 'v1' }],
    })
    const result = await publishReviewPlaybook(asClient(fake), {
      slug: 'ma-trust-firm-qa',
      title: 'Trust review',
      rules: RULES,
      changeSummary: null,
      userId: 'user-1',
    })
    expect(result).toMatchObject({ ok: true, versionNumber: 2 })
    expect(fake.tableRows('prompt_versions')).toHaveLength(2)
    expect(fake.tableRows('prompt_publications')).toHaveLength(1)

    const loaded = await loadPublishedPrompt(asClient(fake), 'ma-trust-firm-qa')
    expect(loaded?.versionNumber).toBe(2)
    expect(loaded?.body.kind === 'review' && loaded.body.rules).toHaveLength(2)
  })

  it('will not publish a review over a field-audit prompt with the same id', async () => {
    const fake = makeFakeClient({
      prompts: [{ id: 'p-audit', slug: 'ma-design-sheet-audit', title: 'Audit', kind: 'field_audit' }],
    })
    const result = await publishReviewPlaybook(asClient(fake), {
      slug: 'ma-design-sheet-audit',
      title: 'Audit',
      rules: RULES,
      changeSummary: null,
      userId: 'user-1',
    })
    expect(result.ok).toBe(false)
    expect(fake.tableRows('prompt_versions')).toHaveLength(0)
  })

  it('refuses a malformed id and an empty rule list', async () => {
    const fake = makeFakeClient()
    const base = { title: 'T', changeSummary: null, userId: 'u' }
    expect((await publishReviewPlaybook(asClient(fake), { ...base, slug: 'Bad Slug', rules: RULES })).ok).toBe(false)
    expect((await publishReviewPlaybook(asClient(fake), { ...base, slug: 'ok-slug', rules: [] })).ok).toBe(false)
    expect(fake.tableRows('prompts')).toHaveLength(0)
  })
})

describe('conditions in a published body', () => {
  it('stores conditions only on rules that have them', () => {
    const body = buildReviewBody([
      { statement: 'Guardians are named.', risk: 'high', conditions: [{ fact: 'has_minor_children', test: 'is', value: true }] },
      { statement: 'Bond is waived.', risk: 'low', conditions: [] },
    ])
    expect(body.rules[0].conditions).toEqual([{ fact: 'has_minor_children', test: 'is', value: true }])
    expect('conditions' in body.rules[1]).toBe(false)
  })
})
