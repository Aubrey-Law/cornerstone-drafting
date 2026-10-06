import 'server-only'

/**
 * Where a client-reported retitling meets the delegation dial.
 *
 * The client has said a step is done and, usually, sent the institution's
 * confirmation. Someone at the firm has to read it before the asset is
 * confirmed, and that is a task. The task is proposed through the dial as the
 * existing `task.create` action, so the firm's position for creating tasks
 * decides whether it waits as a card on Today or is simply there in the
 * morning. Keyed to the asset and the document, so re-sending the same
 * confirmation does not stack tasks.
 */
export async function delegateFundingConfirmationReview(input: {
  matterId: string
  assetId: string
  assetLabel: string
  documentId: string | null
  note: string | null
}): Promise<'proposed' | 'done' | 'observed' | 'skipped' | 'failed'> {
  try {
    const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
    const actor = await resolveUnattendedActor()
    if (!actor) return 'skipped'

    const { createActionProposal } = await import('@/lib/actions/server')
    const what = input.documentId
      ? `Check the confirmation the client sent for ${input.assetLabel} and mark it confirmed if it shows the transfer`
      : `The client says ${input.assetLabel} is done but sent no confirmation; ask the institution or the client for it`
    const created = await createActionProposal({
      actionKey: 'task.create',
      displaySummary: `Review the client’s retitling of ${input.assetLabel}`,
      referencePayload: {
        title: `Review retitling: ${input.assetLabel}`.slice(0, 300),
        description: [what, input.note ? `Client note: ${input.note}` : null].filter(Boolean).join('\n\n'),
        matter_id: input.matterId,
        priority: 'normal',
        ...(input.documentId ? { document_id: input.documentId } : {}),
      },
      recordType: 'matter',
      recordId: input.matterId,
      source: 'automation',
      idempotencyKey: `funding-review:${input.matterId}:${input.assetId}:${input.documentId ?? 'no-document'}`,
      applyAutonomy: true,
    }, actor)
    if (created.duplicate) return 'skipped'
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution) return created.execution.status === 'succeeded' ? 'done' : 'failed'
    return 'proposed'
  } catch (error) {
    console.error('[portal assets] review delegation failed', { matterId: input.matterId, cause: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}
