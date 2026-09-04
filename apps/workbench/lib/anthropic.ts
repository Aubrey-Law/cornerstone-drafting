import Anthropic from '@anthropic-ai/sdk'
import type {
  ModelCallContext,
  ModelCaller,
  ModelRequest,
  ModelResponse,
} from '@aubrey-law/citations/review/model'
import { logAiUsage, type AiUsageRow } from '@/lib/aiUsage'

/**
 * The Workbench's own model caller.
 *
 * Its own, not the old app's, because the review package takes its caller as an
 * argument on purpose: sharing one would mean sharing a retry policy and
 * writing usage rows under the other app's accounting.
 *
 * Everything it depends on is injected, so the retry and accounting behaviour
 * is tested without a network, an API key, or a real clock.
 */

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 500

export function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const status =
    (error as { status?: number; statusCode?: number }).status ??
    (error as { status?: number; statusCode?: number }).statusCode
  // No HTTP status at all means the request never got an answer — a transport
  // failure, which is exactly the case worth retrying.
  if (status === undefined) return true
  if (status === 408 || status === 429) return true
  return status >= 500 && status < 600
}

export interface ModelCallerDependencies {
  createMessage: (request: ModelRequest) => Promise<ModelResponse>
  logUsage: (row: AiUsageRow) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

export function createModelCaller(deps: ModelCallerDependencies): ModelCaller {
  return async function callModel(request: ModelRequest, context: ModelCallContext) {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now()
      try {
        const response = await deps.createMessage(request)
        const usage = response.usage ?? null
        // Accounting is never worth losing a completed call over.
        await deps
          .logUsage({
            route: context.route,
            contextType: context.contextType ?? null,
            matterId: context.matterId ?? null,
            userId: context.userId ?? null,
            model: request.model,
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
            cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
            durationMs: Date.now() - startedAt,
            success: true,
          })
          .catch(() => {})
        return response
      } catch (error) {
        lastError = error
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
          // Written before throwing: a run that failed still spent money and
          // still needs to show up in the accounting.
          await deps
            .logUsage({
              route: context.route,
              contextType: context.contextType ?? null,
              matterId: context.matterId ?? null,
              userId: context.userId ?? null,
              model: request.model,
              durationMs: Date.now() - startedAt,
              success: false,
              errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
            })
            .catch(() => {})
          throw error
        }
        await deps.sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * BASE_DELAY_MS)
      }
    }

    throw lastError ?? new Error('The model call failed')
  }
}

export class AnthropicKeyMissingError extends Error {
  constructor() {
    super(
      'ANTHROPIC_API_KEY is not set, so a review cannot be run. Set it on this app’s environment.',
    )
    this.name = 'AnthropicKeyMissingError'
  }
}

/** The real caller. Throws a named error when the key is absent, rather than a 401 from the SDK. */
export function anthropicModelCaller(): ModelCaller {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey?.trim()) throw new AnthropicKeyMissingError()
  const client = new Anthropic({ apiKey })

  return createModelCaller({
    // The non-streaming overload returns a Message; nothing here passes stream.
    createMessage: (request) => client.messages.create(request) as Promise<ModelResponse>,
    logUsage: logAiUsage,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
}
