import type { AdminChatToolEmit } from '@/lib/adminChat/engine'

/**
 * Writes the assistant may only *propose*.
 *
 * A tool that mutates firm or client data is not gated by a sentence in the
 * system prompt — client-authored text reaches that prompt, so a note or intake
 * field could ask for the write. Instead the tool returns a proposal, the card
 * renders an Accept button, and the acceptance route adapts it into the shared
 * action registry. That service revalidates the payload under the attorney's
 * own session, reserves an idempotency key, and records the result.
 */
export type AssistantProposalKind =
  | 'create_hold'
  | 'propose_reschedule'
  | 'create_task'
  | 'create_lead'
  | 'register_custom_template'

export interface AssistantProposal {
  id: string
  title: string
  rationale: string
  kind: AssistantProposalKind
  payload: Record<string, unknown>
}

export interface ProposeOptions {
  kind: AssistantProposalKind
  toolUseId: string
  emit: AdminChatToolEmit
  /** Tool name to emit under — usually the same as `kind`. */
  toolName?: string
  title: string
  rationale?: string
  payload: Record<string, unknown>
}

/** Emit a proposal card and tell the model the write has not happened yet. */
export function proposeWrite(options: ProposeOptions): { content: string } {
  const proposal: AssistantProposal[] = [{
    id: options.toolUseId,
    title: options.title,
    rationale: options.rationale ?? '',
    kind: options.kind,
    payload: options.payload,
  }]
  options.emit({
    tool: options.toolName ?? options.kind,
    tool_use_id: options.toolUseId,
    status: 'done',
    result: { proposal },
  })
  return {
    content: JSON.stringify({
      ok: true,
      proposed: true,
      changes: proposal,
      requires_acceptance: true,
      note: 'Nothing has been created yet. Tell the attorney what you propose and that they must accept it.',
    }),
  }
}
