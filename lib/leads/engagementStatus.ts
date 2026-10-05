/**
 * Statuses of an in-app agreement that has not gone to the client through the
 * app. While it sits in one of these, the engagement can still have been sent
 * some other way — emailed as a PDF, or through another e-sign service.
 */
const NOT_SENT_IN_APP = new Set(['draft', 'ready', 'failed'])

/** Agreement statuses that mean the app itself sent it. */
const SENT_IN_APP = new Set(['sending', 'sent', 'viewed', 'partially_signed', 'completed'])

export function agreementSentInApp(agreementStatus: string | null | undefined): boolean {
  return SENT_IN_APP.has(String(agreementStatus ?? ''))
}

/**
 * The engagement status a lead should show.
 *
 * The in-app agreement's status used to win outright, so an agreement drafted
 * in the workspace but sent outside the app read "Draft" forever. Once the app
 * has sent it, its own status is the truth; before that, a send (or signature)
 * recorded on the lead by hand takes precedence over the draft.
 */
export function effectiveEngagementStatus(
  agreementStatus: string | null | undefined,
  lead: { engagement_status?: string | null; engagement_sent_at?: string | null; engagement_signed_at?: string | null },
): string | null {
  if (agreementStatus && !NOT_SENT_IN_APP.has(agreementStatus)) return agreementStatus
  if (lead.engagement_signed_at || lead.engagement_status === 'signed') return 'signed'
  if (lead.engagement_sent_at || lead.engagement_status === 'sent') return 'sent'
  return agreementStatus ?? lead.engagement_status ?? null
}
