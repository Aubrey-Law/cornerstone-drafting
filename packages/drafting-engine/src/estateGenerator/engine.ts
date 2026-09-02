export type EstateGeneratorEngine = 'node' | 'supabase'

/**
 * Primary document generator for bulk draft runs.
 *
 * - `node` (default): Nunjucks + docxtemplater packages in tools/aubreylaw-docgeneration
 * - `supabase`: DOCX templates from Supabase Storage (`templates` bucket)
 *
 * Set `ESTATE_GENERATOR_ENGINE=supabase` to force the Supabase template path.
 * The deprecated alias `typescript` is treated as `supabase`. The legacy
 * `python` subprocess engine has been retired; its value falls through to `node`.
 */
export function resolveEstateGeneratorEngine(): EstateGeneratorEngine {
  const raw = process.env.ESTATE_GENERATOR_ENGINE?.trim().toLowerCase()
  if (raw === 'supabase' || raw === 'typescript') return 'supabase'
  return 'node'
}

/**
 * Provenance label recorded on matter_documents when a document was drafted by
 * the language model rather than rendered from a template.
 *
 * This used to return 'python_fallback', named for a Python subprocess engine
 * that was retired (see above — its value now falls through to `node`). So a
 * document whose text came from an LLM completion was filed under the name of
 * an engine that had not run in months, and the audit trail for a client
 * instrument said something that was not true.
 */
export function llmFallbackEngineLabel(): 'llm_fallback' {
  return 'llm_fallback'
}

/**
 * Whether a failed template render may fall back to drafting the document with
 * the language model.
 *
 * Off unless explicitly enabled. The fallback calls /api/drafting once per
 * document — an Anthropic completion — and persists the result as a draft of a
 * will or trust. That is a reasonable thing to ask for deliberately and a bad
 * thing to get by accident: as an automatic response to a template bug, a
 * regression in a template silently becomes model-authored text in a client's
 * instrument. With this off, a template failure surfaces as an error to the
 * drafter, which is the outcome they can act on.
 */
export function llmDraftFallbackEnabled(): boolean {
  return process.env.ESTATE_DRAFT_LLM_FALLBACK_ENABLED?.trim().toLowerCase() === 'true'
}
