import Anthropic from '@anthropic-ai/sdk'
import { logAiUsage } from '@/lib/aiUsage'

const anthropic = new Anthropic()

/** Resolve Anthropic SDK client (env ANTHROPIC_API_KEY). */
export async function getAnthropicClient(): Promise<Anthropic> {
  return anthropic
}

export type AnthropicMessageRequest = Parameters<typeof anthropic.messages.create>[0]
export type AnthropicMessageResponse = Anthropic.Message

export interface CallContext {
  /** Route identifier for ai_usage (e.g. 'admin/engagement', 'drafting'). Required. */
  route: string
  /** Optional matter for cost attribution. */
  matterId?: string | null
  /** Optional user that triggered the call (attorney). */
  userId?: string | null
  /** Optional context category. */
  contextType?: 'matter' | 'lead' | 'general' | string | null
  /** Per-call override of the retry policy. */
  retry?: { attempts?: number; baseDelayMs?: number }
}

/**
 * Centralized Anthropic call wrapper. Provides:
 *   * Exponential-backoff retry on transient errors (5xx, 429, network).
 *     Non-retryable errors (4xx that aren't 429, validation) bubble up
 *     immediately so callers see real bugs.
 *   * Always-on ai_usage logging (success and failure rows). Includes token
 *     counts when present, latency, model, route, matter id.
 *   * Hides the singleton SDK client behind a function so tests can stub it.
 *
 * Returns the underlying Anthropic Message on success. On unrecoverable
 * failure, throws after writing a failure ai_usage row.
 */
export async function callAnthropic(
  req: AnthropicMessageRequest,
  ctx: CallContext,
): Promise<AnthropicMessageResponse> {
  const attempts = Math.max(1, ctx.retry?.attempts ?? 3)
  const baseDelayMs = Math.max(50, ctx.retry?.baseDelayMs ?? 500)

  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now()
    try {
      // The non-streaming overload returns Anthropic.Message; we don't pass
      // stream:true here. Cast to narrow.
      const response = (await anthropic.messages.create(req)) as Anthropic.Message
      const usage = response.usage ?? null
      void logAiUsage({
        route: ctx.route,
        contextType: ctx.contextType ?? null,
        matterId: ctx.matterId ?? null,
        userId: ctx.userId ?? null,
        model: req.model,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
        durationMs: Date.now() - startedAt,
        success: true,
      })
      return response
    } catch (e) {
      lastError = e
      const retryable = isRetryable(e)
      const last = attempt === attempts
      if (!retryable || last) {
        void logAiUsage({
          route: ctx.route,
          contextType: ctx.contextType ?? null,
          matterId: ctx.matterId ?? null,
          userId: ctx.userId ?? null,
          model: req.model,
          durationMs: Date.now() - startedAt,
          success: false,
          errorMessage: errMessage(e),
        })
        throw e
      }
      // Exponential backoff with jitter.
      const sleep = baseDelayMs * 2 ** (attempt - 1) + Math.random() * baseDelayMs
      await new Promise((r) => setTimeout(r, sleep))
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError ?? new Error('Anthropic call failed')
}

function isRetryable(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const status = (e as { status?: number; statusCode?: number }).status
              ?? (e as { status?: number; statusCode?: number }).statusCode
  if (status === undefined) {
    // No HTTP status — assume network/transport, retry.
    return true
  }
  if (status === 408 || status === 429) return true
  if (status >= 500 && status < 600) return true
  return false
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message.slice(0, 500)
  try {
    return String(e).slice(0, 500)
  } catch {
    return 'unknown error'
  }
}

/**
 * The prompt-hardening helpers now live in @aubrey-law/citations, beside the
 * review runner — the code path that most needs them, and the one both apps
 * share. Re-exported here so this module stays the single import site for
 * everything Anthropic-related in the old app.
 */
export { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@aubrey-law/citations/prompt'
