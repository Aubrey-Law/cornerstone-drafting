/** Cornerstone Lite has no leads CRM — intake never syncs to leads. */
export function intakePayloadTouchesLead(_fields: Record<string, unknown>): boolean {
  return false
}

export async function syncLeadFromIntake(..._args: unknown[]): Promise<void> {
  /* no-op */
}
