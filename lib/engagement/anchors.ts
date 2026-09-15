/**
 * The signature anchor markers an engagement template carries.
 *
 * One definition, because there are two callers that must agree exactly: the
 * send path, which tells the provider where the fields go, and the signing
 * path, which stamps them. If those two ever disagree the signer gets an
 * anchor-not-found error — or worse, signs on someone else's line.
 *
 * Recipients are numbered by position in the agreement, not by role:
 * `assets/engagement-agreements/ep-trust-couple-v1.docx` carries
 * `[[CLIENT_1_SIGNATURE]]` and `[[CLIENT_2_SIGNATURE]]`, with the spouse as
 * CLIENT_2. There is no `[[SPOUSE_*]]` marker in any template, and a role-named
 * prefix would resolve to nothing.
 */

export interface EngagementAnchorMarkers {
  signature: string
  date: string
}

/** @param position 1-based position in the agreement's recipient order. */
export function engagementAnchorMarkers(position: number): EngagementAnchorMarkers {
  return {
    signature: `[[CLIENT_${position}_SIGNATURE]]`,
    date: `[[CLIENT_${position}_DATE]]`,
  }
}

/** Every marker an agreement with this many recipients expects to contain. */
export function allEngagementAnchorMarkers(recipientCount: number): string[] {
  return Array.from({ length: recipientCount }, (_, index) => {
    const { signature, date } = engagementAnchorMarkers(index + 1)
    return [signature, date]
  }).flat()
}
