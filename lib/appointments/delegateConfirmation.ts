import type { ConfirmationEvent } from './confirmationEmail'

/**
 * Where a booking's confirmation email meets the delegation dial.
 *
 * A confirmation is transactional: the client just booked and expects it at
 * once. So this action's default position is "Act and report" rather than
 * "Propose": by default the email still goes out immediately, and the send
 * now shows in the digest and on Today. Turning the dial down to Propose
 * holds confirmations for a click; Observe records them without sending.
 *
 * The one thing the dial may never do is lose a confirmation to plumbing.
 * When no staff user can be resolved to act as, or the action service itself
 * is unreachable, the caller falls back to sending directly as it always has.
 */

export const APPOINTMENT_CONFIRMATION_ACTION_KEY = 'appointment.confirmation.send'

export type ConfirmationDelegationOutcome = 'fallback' | 'observed' | 'proposed' | 'sent' | 'failed'

export interface ConfirmationDelegationInput {
  appointmentId: string
  event: ConfirmationEvent
  /** Raw manage-link token for a fresh booking; null on a reschedule. */
  manageToken: string | null
  attendeeName: string
  typeLabel: string
  when: string
  leadId: string | null
  matterId: string | null
  /** Staff who booked it, if any; otherwise the firm's attorney is resolved. */
  actorId: string | null
}

export function confirmationSummary(input: Pick<ConfirmationDelegationInput, 'event' | 'typeLabel' | 'attendeeName' | 'when'>): string {
  const verb = input.event === 'rescheduled' ? 'Confirm the rescheduled' : 'Confirm the'
  return `${verb} ${input.typeLabel} with ${input.attendeeName} on ${input.when}`
}

export async function delegateAppointmentConfirmation(input: ConfirmationDelegationInput): Promise<ConfirmationDelegationOutcome> {
  let actorId = input.actorId
  if (!actorId) {
    try {
      const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
      actorId = (await resolveUnattendedActor())?.id ?? null
    } catch {
      actorId = null
    }
  }
  if (!actorId) return 'fallback'

  try {
    const { createActionProposal } = await import('@/lib/actions/server')
    const created = await createActionProposal({
      actionKey: APPOINTMENT_CONFIRMATION_ACTION_KEY,
      displaySummary: confirmationSummary(input),
      // The manage token rides along because only its hash is stored: the
      // link in a confirmation held for a click must still be the one the
      // booking minted. The payload is service-role only, and the sent
      // email's own log already holds the same link.
      referencePayload: { appointmentId: input.appointmentId, event: input.event, manageToken: input.manageToken },
      recordType: input.matterId ? 'matter' : input.leadId ? 'lead' : 'firm',
      recordId: input.matterId ?? input.leadId ?? undefined,
      source: 'automation',
      idempotencyKey: `appointment-confirmation:${input.appointmentId}:${input.event}:${input.when}`,
      applyAutonomy: true,
    }, { id: actorId })
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution?.status === 'succeeded') return 'sent'
    if (created.execution) return 'failed'
    return created.duplicate ? 'sent' : 'proposed'
  } catch (error) {
    const { ActionServiceError } = await import('@/lib/actions/errors')
    // The email went out and only its audit row is unsettled: a fallback send
    // here would be a second confirmation.
    if (error instanceof ActionServiceError && error.code === 'audit_finalization_pending') return 'sent'
    console.error('appointment confirmation delegation failed; sending directly', {
      appointmentId: input.appointmentId,
      cause: error instanceof Error ? error.message : String(error),
    })
    return 'fallback'
  }
}
