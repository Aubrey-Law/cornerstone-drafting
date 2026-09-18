/**
 * Why a matter cannot be destroyed on a single click. Neither is a refusal —
 * both are satisfied by an administrator confirming the permanent deletion —
 * but each names client work that is about to be destroyed with the matter.
 *
 * Kept apart from `deleteMatter` so the dialogs that have to say all this can
 * import the words without dragging the storage client into the browser
 * bundle.
 */
export type MatterDeletionProtection = 'hired' | 'signed_engagement'

export const MATTER_DELETION_PROTECTION_LABELS: Record<MatterDeletionProtection, string> = {
  hired: 'this is a hired client matter, not a prospect',
  signed_engagement: 'a signed engagement agreement is attached to it',
}

/** The protections a response reported, as something a person can read. */
export function describeDeletionProtections(protections: readonly string[]): string[] {
  return protections.map(protection =>
    MATTER_DELETION_PROTECTION_LABELS[protection as MatterDeletionProtection] ?? protection,
  )
}
