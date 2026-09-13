import { getAdminClient } from '@/lib/supabaseAdmin'

export interface AiUsageLogInput {
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
 * Insert one row into `ai_usage`. Best-effort: errors are logged but never thrown,
 * so a logging failure can't break a chat response.
 */
export async function logAiUsage(input: AiUsageLogInput): Promise<void> {
  try {
    const admin = getAdminClient()
    await admin.from('ai_usage').insert({
      route: input.route,
      context_type: input.contextType ?? null,
      matter_id: input.matterId ?? null,
      user_id: input.userId ?? null,
      model: input.model,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      cache_read_input_tokens: input.cacheReadInputTokens ?? 0,
      cache_creation_input_tokens: input.cacheCreationInputTokens ?? 0,
      duration_ms: input.durationMs ?? null,
      success: input.success ?? true,
      error_message: input.errorMessage ?? null,
    })
  } catch (e) {
    console.error('[ai_usage] log failed', e)
  }
}

/**
 * Approximate USD cost for a usage row using current published Anthropic rates.
 * Numbers are kept inline (not configurable) on purpose — they're hints for
 * the attorney's settings panel, not billing-grade. Update when Anthropic
 * changes pricing.
 *
 * Rates per million tokens, USD:
 *   - claude-opus-4-6/4-7/4-8: $5 input / $25 output
 *   - claude-opus-4-5 & older: $15 input / $75 output
 *   - claude-sonnet-*        : $3  input / $15 output
 *   - claude-haiku-*         : $0.80 input / $4 output
 *   Cache reads              : 10% of input rate
 *   Cache writes             : 125% of input rate
 *
 * Anthropic models only. The add-in and matter assistants resolve a per-user
 * provider (`lib/llm/resolve.ts`), so `ai_usage.model` can hold an OpenAI or
 * Gemini id — those used to fall through to the Opus rate and be reported as
 * three-figure Anthropic spend. They return 0 now, which is honestly "not
 * priced here" rather than confidently wrong.
 */
export function estimateUsdCost(row: {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}): number {
  const m = row.model.toLowerCase()
  if (!m.includes('claude')) return 0
  let inRate = 15, outRate = 75
  if (m.includes('haiku')) { inRate = 0.8; outRate = 4 }
  else if (m.includes('sonnet')) { inRate = 3; outRate = 15 }
  else if (m.includes('opus-4-8') || m.includes('opus-4-7') || m.includes('opus-4-6')) { inRate = 5; outRate = 25 }
  else if (m.includes('opus')) { inRate = 15; outRate = 75 }
  const cacheReadRate = inRate * 0.1
  const cacheWriteRate = inRate * 1.25
  const cost =
    (row.input_tokens * inRate +
      row.output_tokens * outRate +
      row.cache_read_input_tokens * cacheReadRate +
      row.cache_creation_input_tokens * cacheWriteRate) / 1_000_000
  return Math.round(cost * 10000) / 10000
}
