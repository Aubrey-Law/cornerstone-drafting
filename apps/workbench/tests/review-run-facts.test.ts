import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { deriveMatterFacts } from '@aubrey-law/citations/review/conditions'
import { loadRunContext } from '@/lib/runs/context'
import { loadMatterFacts } from '@/lib/review/matterFacts'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { makeFakeClient } from './helpers/fakeSupabase'

const TEXT = 'The Trustee shall serve without bond.'
const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as SupabaseClient<WorkbenchDatabase>

function seed(resolvedInputs: unknown) {
  return makeFakeClient({
    workflow_runs: [
      {
        id: 'run-1',
        kind: 'review',
        prompt_version_id: 'v1',
        matter_id: 'm1',
        resolved_inputs: resolvedInputs,
        text_layer_id: 'layer-1',
        document_version_id: 'docver-1',
        model: null,
        render_version: 1,
      },
    ],
    prompts: [{ id: 'p1', slug: 'review-1', title: 'Review One', kind: 'review' }],
    prompt_versions: [
      {
        id: 'v1',
        version_number: 1,
        prompt_id: 'p1',
        body: {
          kind: 'review',
          inputs: [],
          rules: [
            {
              number: '1',
              risk: 'high',
              statement: 'Guardians are named.',
              conditions: [{ fact: 'has_minor_children', test: 'is', value: true }],
            },
          ],
        },
      },
    ],
    document_text_layers: [
      {
        id: 'layer-1',
        source_kind: 'docx',
        status: 'ok',
        extractor: 'test',
        extractor_version: '1',
        source_sha256: 'a'.repeat(64),
        page_count: null,
        text: TEXT,
        blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
        spans: [],
      },
    ],
  })
}

describe('matter facts on a review run', () => {
  it('reads back the facts pinned when the run opened, so a retry skips the same rules', async () => {
    const facts = deriveMatterFacts({ children: [{ name: 'A', is_minor: false }] })
    const context = await loadRunContext(asClient(seed({ matterFacts: facts })), 'run-1')
    expect(context.ok && context.kind === 'review' && context.matterFacts).toEqual(facts)
  })

  it('has no facts for a run opened before conditions existed, so every rule runs', async () => {
    const context = await loadRunContext(asClient(seed(null)), 'run-1')
    expect(context.ok && context.kind === 'review' && context.matterFacts).toBeNull()
  })

  it('derives facts from the current design sheet, or none when there is no sheet', async () => {
    const fake = makeFakeClient({
      design_sheets: [
        { matter_id: 'm1', version: 1, marital_status: 'single', is_joint: false, children: [], plan_type: null, assets: [] },
        { matter_id: 'm1', version: 2, marital_status: 'married', is_joint: false, children: [], plan_type: null, assets: [] },
      ],
    })
    expect((await loadMatterFacts(asClient(fake), 'm1'))?.married).toBe(true)
    expect(await loadMatterFacts(asClient(fake), 'm2')).toBeNull()
  })
})
