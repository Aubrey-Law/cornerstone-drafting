import 'server-only'

/**
 * Hand the signing-day kit to the delegation dial the moment a signing
 * appointment is booked for a matter.
 *
 * The kit page itself is always there to print. What the dial decides is
 * whether the firm's record of the appointment is opened and a task to print
 * the kit is created without anyone asking: at Propose it waits as a card on
 * Today; at Act it is done and reported. Keyed to the matter and the signing
 * day, so a reschedule proposes once more and a duplicate booking does not.
 */
export async function delegateSigningKit(input: {
  matterId: string
  scheduledFor: string | null
  /** The staff member who booked, else the firm's unattended actor. */
  actorId?: string | null
}): Promise<'proposed' | 'done' | 'observed' | 'skipped' | 'failed'> {
  try {
    const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
    const actor = input.actorId ? { id: input.actorId } : await resolveUnattendedActor()
    if (!actor) return 'skipped'
    const { createActionProposal } = await import('@/lib/actions/server')
    const day = input.scheduledFor ? input.scheduledFor.slice(0, 10) : 'unscheduled'
    const created = await createActionProposal({
      actionKey: 'signing.kit.prepare',
      displaySummary: `Prepare the signing-day kit${input.scheduledFor ? ` for ${day}` : ''}`,
      referencePayload: { matterId: input.matterId, scheduledFor: input.scheduledFor },
      recordType: 'matter',
      recordId: input.matterId,
      source: 'automation',
      idempotencyKey: `signing-kit:${input.matterId}:${day}`,
      applyAutonomy: true,
    }, actor)
    if (created.duplicate) return 'skipped'
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution) return created.execution.status === 'succeeded' ? 'done' : 'failed'
    return 'proposed'
  } catch (error) {
    console.error('[signing] kit delegation failed', { matterId: input.matterId, cause: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}
