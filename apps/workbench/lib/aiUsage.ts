import { getAdminClient } from '@/lib/supabase/admin'

export interface AiUsageRow {
  route: string
  contextType?: string | null
  matterId?: string | null
  userId?: string | null
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  durationMs?: number
  success?: boolean
  errorMessage?: string | null
}

/**
 * One row per model call, into the same `ai_usage` table the old app writes.
 *
 * Shared deliberately: cost per matter should not depend on which app made the
 * call, and the settings screen that reports it already reads this table.
 *
 * Best-effort. A failure here is logged and swallowed by the caller, because
 * accounting is not worth losing a review over.
 */
export async function logAiUsage(row: AiUsageRow): Promise<void> {
  const { error } = await getAdminClient()
    .from('ai_usage')
    .insert({
      route: row.route,
      context_type: row.contextType ?? null,
      matter_id: row.matterId ?? null,
      user_id: row.userId ?? null,
      model: row.model,
      input_tokens: row.inputTokens ?? 0,
      output_tokens: row.outputTokens ?? 0,
      cache_read_input_tokens: row.cacheReadInputTokens ?? 0,
      cache_creation_input_tokens: row.cacheCreationInputTokens ?? 0,
      duration_ms: row.durationMs ?? null,
      success: row.success ?? true,
      error_message: row.errorMessage ?? null,
    })
  if (error) console.error('[ai_usage] insert failed', error.message)
}
