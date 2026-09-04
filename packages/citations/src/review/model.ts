import type Anthropic from '@anthropic-ai/sdk'

/**
 * The seam between a review and whoever makes the model call.
 *
 * The caller is injected rather than imported, and it is **required** rather
 * than defaulted. A package that silently falls back to one app's client is a
 * fork waiting to happen: the other app gets different retry behaviour and
 * different usage accounting without anything in the code saying so. Making it
 * an argument means each app supplies its own wrapper — and it is why the whole
 * review pipeline is testable with a scripted response and no API key.
 */
export type ModelRequest = Anthropic.MessageCreateParams
export type ModelResponse = Anthropic.Message

export interface ModelCallContext {
  /** Route identifier for usage accounting (e.g. 'review/playbook'). */
  route: string
  matterId?: string | null
  userId?: string | null
  contextType?: 'matter' | 'lead' | 'general' | string | null
}

export type ModelCaller = (
  request: ModelRequest,
  context: ModelCallContext,
) => Promise<ModelResponse>
