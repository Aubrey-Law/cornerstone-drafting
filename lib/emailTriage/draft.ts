import { logAiUsage } from '@/lib/aiUsage'
import { PROMPT_INJECTION_GUARDRAIL, getAnthropicClient } from '@/lib/anthropic'
import { loadLeadContext, loadMatterContext } from '@/lib/adminChat/engine'
import { resolveFirmModel } from '@/lib/firmModels'
import { describeError } from './describeError'
import type { SenderClassification } from './classifySender'
import {
  TRIAGE_INSTRUCTIONS,
  buildUnknownSenderSystemPrompt,
  quoteInboundEmail,
  replySubject,
} from './prompt'

/**
 * Draft a reply to one triaged message.
 *
 * Shared by the cron and the Regenerate button rather than either calling the
 * other over HTTP, so the prompt and the usage accounting exist once.
 */

export const TRIAGE_DRAFT_MAX_TOKENS = 800

export interface TriageDraftInput {
  classification: SenderClassification
  clientIntakeId: string | null
  matterId: string | null
  senderEmail: string
  senderName: string | null
  subject: string | null
  receivedAt: string
  /** The inbound message body, read live from Gmail. UNTRUSTED. */
  bodyText: string
  /** Free-text steer from the attorney, when regenerating. */
  notes?: string | null
  userId: string | null
  route: 'admin/email-triage' | 'cron/email-triage'
}

export interface TriageDraftResult {
  subject: string
  body: string
  model: string
}

/**
 * The system prompt for this sender.
 *
 * A matched client or lead gets the same context the matter assistant uses, so
 * the draft knows what stage the work is at. An unmatched sender gets the
 * deliberately narrow stranger prompt. The guardrail is appended in every case,
 * including the two that build their prompt elsewhere — `loadMatterContext`
 * feeds surfaces that never quote a stranger's email, so it does not carry one
 * of its own.
 */
async function resolveSystemPrompt(input: TriageDraftInput): Promise<string> {
  if (input.classification === 'client' && input.matterId) {
    const context = await loadMatterContext(input.matterId)
    return `${context.systemPrompt}\n\n${PROMPT_INJECTION_GUARDRAIL}`
  }
  if (input.classification === 'lead' && input.clientIntakeId) {
    const context = await loadLeadContext(input.clientIntakeId)
    return `${context.systemPrompt}\n\n${PROMPT_INJECTION_GUARDRAIL}`
  }
  return buildUnknownSenderSystemPrompt()
}

export async function generateTriageDraft(input: TriageDraftInput): Promise<TriageDraftResult> {
  const startedAt = Date.now()
  const model = await resolveFirmModel('assistant')
  let usageModel = model

  try {
    const systemPrompt = await resolveSystemPrompt(input)
    const anthropic = await getAnthropicClient()

    const userContent = [
      TRIAGE_INSTRUCTIONS,
      input.notes?.trim()
        ? `The attorney wants the reply to cover: ${input.notes.trim()}`
        : '',
      quoteInboundEmail({
        fromName: input.senderName,
        fromEmail: input.senderEmail,
        subject: input.subject ?? '',
        receivedAt: input.receivedAt,
        body: input.bodyText,
      }),
      'Output only the reply body.',
    ].filter(Boolean).join('\n\n')

    const response = await anthropic.messages.create({
      model,
      max_tokens: TRIAGE_DRAFT_MAX_TOKENS,
      system: [{
        type: 'text' as const,
        text: systemPrompt,
        // A morning batch drafts several replies against the same firm context;
        // caching it is the difference between paying for it once and N times.
        cache_control: { type: 'ephemeral' as const },
      }],
      messages: [{ role: 'user', content: userContent }],
    })
    if (response.model) usageModel = response.model

    const body = response.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim()

    void logAiUsage({
      route: input.route,
      contextType: input.classification === 'client' ? 'matter' : 'lead',
      matterId: input.matterId ?? input.clientIntakeId,
      userId: input.userId,
      model: usageModel,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
      durationMs: Date.now() - startedAt,
      success: true,
    })

    return {
      // Computed, never generated — see `replySubject`.
      subject: replySubject(input.subject),
      body,
      model: usageModel,
    }
  } catch (error) {
    const detail = describeError(error)
    void logAiUsage({
      route: input.route,
      contextType: input.classification === 'client' ? 'matter' : 'lead',
      matterId: input.matterId ?? input.clientIntakeId,
      userId: input.userId,
      model: usageModel,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      success: false,
      errorMessage: detail,
    })
    throw new Error(`Unable to draft a reply: ${detail}`)
  }
}
