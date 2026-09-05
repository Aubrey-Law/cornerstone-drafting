import type { FieldReference, FieldReferenceClaim } from './types'

/** Whitespace and case are presentation, not substance. Nothing else is folded. */
function normalise(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Checks one claim about one field against what the field holds.
 *
 * The field analogue of `verifyQuote` (see textLayer/match.ts), and it follows
 * the same rule: what the model produced is a *claim* until this function
 * finds it in the source. The difference is only in what the source is — a
 * design-sheet value instead of a document's text layer, so there is no
 * offset to recover and no ambiguity to detect, only agreement or its absence.
 *
 * A reference outside the check's declared `reads` fails without being
 * compared. The scope is part of the check, and a finding resting on a field
 * nobody authorised it to read is not better for happening to be right.
 */
export function verifyFieldReference(
  values: Record<string, unknown>,
  reads: string[],
  claim: FieldReferenceClaim,
): FieldReference {
  if (!reads.includes(claim.fieldKey)) {
    return { ...claim, actualValue: null, verification: 'unverified' }
  }

  const actual = values[claim.fieldKey] ?? null
  const actualText = actual === null ? null : typeof actual === 'string' ? actual : JSON.stringify(actual)
  const matches = normalise(actual) === normalise(claim.claimedValue)

  return {
    ...claim,
    actualValue: actualText,
    verification: matches ? 'verified' : 'unverified',
  }
}
