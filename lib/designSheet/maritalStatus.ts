/**
 * Is the client married for design-sheet purposes?
 *
 * Substring match rather than equality so 'remarried' counts, with 'never
 * married' carved back out — the intake wizard and the admin sheet both offer
 * those wordings, and reading them as "not married" would drop the spouse's
 * documents from the plan.
 */
export function sheetIsMarried(maritalStatus: string | null | undefined): boolean {
  const marital = (maritalStatus ?? '').toLowerCase()
  return marital.includes('married') && !marital.includes('never')
}
