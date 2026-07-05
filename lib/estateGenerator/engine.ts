export type EstateGeneratorEngine = 'node' | 'supabase' | 'python'

/**
 * Primary document generator for bulk draft runs.
 *
 * - `node` (default): Nunjucks + docxtemplater packages in tools/aubreylaw-docgeneration
 * - `supabase`: DOCX templates from Supabase Storage (`templates` bucket)
 * - `python`: subprocess fallback to tools/aubreylaw-docgeneration (legacy)
 *
 * Set `ESTATE_GENERATOR_ENGINE=supabase` to force the Supabase template path.
 * The deprecated alias `typescript` is treated as `supabase`.
 */
export function resolveEstateGeneratorEngine(): EstateGeneratorEngine {
  const raw = process.env.ESTATE_GENERATOR_ENGINE?.trim().toLowerCase()
  if (raw === 'supabase' || raw === 'typescript') return 'supabase'
  if (raw === 'python') return 'python'
  return 'node'
}

/** Recorded on matter_documents when the Node engine defers to Python. */
export function pythonFallbackEngineLabel(): 'python_fallback' {
  return 'python_fallback'
}
