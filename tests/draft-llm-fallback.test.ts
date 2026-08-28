import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { llmDraftFallbackEnabled, llmFallbackEngineLabel } from '@/lib/estateGenerator/engine'

const ROUTE = 'app/api/admin/matters/[id]/draft/route.ts'
const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8')

/**
 * When bulk template rendering failed, the draft route used to call
 * /api/drafting once per document — an Anthropic completion — and persist the
 * result as a draft of a will or trust, with no opt-in and no signal to the
 * drafter. So a regression in a template could put model-authored text into a
 * client instrument, filed under the provenance label 'python_fallback': a
 * Python subprocess engine that lib/estateGenerator/engine.ts records as
 * retired and that had not run in months.
 */
describe('llmDraftFallbackEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  beforeEach(() => {
    vi.stubEnv('ESTATE_DRAFT_LLM_FALLBACK_ENABLED', '')
  })

  it('is off when unset — a template failure must not silently become AI text', () => {
    expect(llmDraftFallbackEnabled()).toBe(false)
  })

  it('is on only for an explicit true', () => {
    vi.stubEnv('ESTATE_DRAFT_LLM_FALLBACK_ENABLED', 'true')
    expect(llmDraftFallbackEnabled()).toBe(true)
    vi.stubEnv('ESTATE_DRAFT_LLM_FALLBACK_ENABLED', 'TRUE')
    expect(llmDraftFallbackEnabled()).toBe(true)
  })

  it('treats every other value as off, including plausible near-misses', () => {
    for (const value of ['1', 'yes', 'on', 'enabled', 'false', 'no', 'maybe']) {
      vi.stubEnv('ESTATE_DRAFT_LLM_FALLBACK_ENABLED', value)
      expect(llmDraftFallbackEnabled(), `"${value}" must not enable the fallback`).toBe(false)
    }
  })
})

describe('draft route fallback gating', () => {
  it('returns the generation error instead of drafting when the fallback is off', () => {
    const source = read(ROUTE)
    expect(source).toContain('if (derivedDocTypes.length > 0 && !llmDraftFallbackEnabled()) {')
    // The guard must come before the call that generates the documents.
    expect(source.indexOf('!llmDraftFallbackEnabled()')).toBeLessThan(
      source.indexOf('generatedFiles = await generateFallbackFiles('),
    )
    expect(source).toContain('ESTATE_DRAFT_LLM_FALLBACK_ENABLED=true')
  })

  it('still reaches the model path when the fallback is enabled', () => {
    const source = read(ROUTE)
    expect(source).toContain('generationEngine = llmFallbackEngineLabel()')
    expect(source).toContain('generateFallbackFiles(req, canonicalMatterId, authHeaders, payload)')
  })
})

describe('generation provenance', () => {
  it('records what actually drafted the document', () => {
    expect(llmFallbackEngineLabel()).toBe('llm_fallback')
  })

  it('no longer writes the retired python_fallback label anywhere', () => {
    for (const file of [ROUTE, 'lib/estateGenerator/engine.ts', 'lib/drafting/persistGeneratedDocument.ts']) {
      expect(read(file), `${file} must not write the retired label`).not.toMatch(
        /generationEngine\s*=\s*['"]python_fallback['"]|pythonFallbackEngineLabel/,
      )
    }
  })

  it('migrates existing rows off the retired label without narrowing too early', () => {
    const migration = read('supabase/migrations/20261021000000_rename_llm_fallback_provenance.sql')

    expect(migration).toContain("set generation_engine = 'llm_fallback'")
    expect(migration).toContain("where generation_engine = 'python_fallback'")
    // Expand/contract: the constraint must still accept the old label, because
    // migrations apply on merge while the code that stops writing it ships with
    // the deploy. Narrowing here would fail inserts in that window.
    expect(migration).toMatch(/check[\s\S]*'python_fallback'/)
    expect(migration).toMatch(/check[\s\S]*'llm_fallback'/)
  })

  it('shows the attorney that a draft was model-authored', () => {
    const review = read('app/admin/drafting/[matterId]/ReviewStep.tsx')

    expect(review).toContain('function isModelDrafted')
    expect(review).toContain('AI-drafted')
    // Legacy rows written before the migration must not read as template output.
    expect(review).toContain("generationEngine === 'python_fallback'")
  })
})
