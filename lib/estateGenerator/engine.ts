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

/** Provenance label recorded on matter_documents for per-document fallback drafting. */
export function pythonFallbackEngineLabel(): 'python_fallback' {
  return 'python_fallback'
}
