import type { FieldReference, FieldReferenceClaim } from './types'

/** Whitespace and case are presentation, not substance. Nothing else is folded. */
function normalise(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Every scalar (string, number, boolean) reachable inside a structured value,
 * in the raw form it actually holds — not yet normalised, so a caller can
 * still report the exact leaf that matched.
 *
 * `null` entries inside the structure (an asset with a blank `value`, say)
 * are not collected: they are not a fact a claim can point at, and a claim of
 * `null` is handled separately as a claim about the whole structure being
 * empty, not about one of its fields being blank.
 */
function collectLeaves(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLeaves(item, out)
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) collectLeaves(entry, out)
  } else if (value !== null && value !== undefined) {
    out.push(value)
  }
  return out
}

/** An array with no elements, or an object with no keys. */
function isEmptyStructure(value: object): boolean {
  return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0
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
 * Several allow-listed fields (`children`, `assets`, `specific_bequests`,
 * `disinheritances`, `residual_beneficiary_individuals`) are jsonb arrays of
 * objects, not scalars. `verifyQuote` does not ask a model to reproduce a
 * whole document, only to point at a phrase really inside it — so a claim
 * about one of these fields is verified the same way: it matches when it
 * equals some leaf value reachable inside the structure, not when it
 * reproduces the structure's exact serialised form. The reference then
 * records the leaf that matched, not the structure it came from, because the
 * point of a reference is to say which fact it rests on.
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

  // A key absent from `values` was never fetched — schema wiring should
  // prevent that (see the refinement in prompt/body.ts), but this is the
  // last line of defence, so it stands on its own. "This field is empty" and
  // "this field was never read" are different claims and only the first is
  // checkable: a legitimately present key can hold `null`, and that case
  // must still verify against a `null` claim, so this cannot be a
  // truthiness or `?? null` check — it has to ask whether the key exists at
  // all. Believing a claim of emptiness about a field nobody fetched would
  // hand back a verified finding about a fact the run never looked at.
  if (!Object.prototype.hasOwnProperty.call(values, claim.fieldKey)) {
    return { ...claim, actualValue: null, verification: 'unverified' }
  }

  const actual = values[claim.fieldKey] ?? null

  if (actual !== null && typeof actual === 'object') {
    // A claim of emptiness is a claim about the whole structure, not about
    // any one leaf inside it — an array with entries is not "empty" merely
    // because none of those entries happens to equal `null`.
    if (claim.claimedValue === null) {
      const empty = isEmptyStructure(actual)
      return {
        ...claim,
        actualValue: empty ? null : JSON.stringify(actual),
        verification: empty ? 'verified' : 'unverified',
      }
    }

    const claimedNorm = normalise(claim.claimedValue)
    const matchedLeaf = collectLeaves(actual).find(leaf => normalise(leaf) === claimedNorm)

    if (matchedLeaf !== undefined) {
      return {
        ...claim,
        actualValue: typeof matchedLeaf === 'string' ? matchedLeaf : JSON.stringify(matchedLeaf),
        verification: 'verified',
      }
    }

    // Nothing inside matched. The whole structure is recorded, not nothing,
    // so the near miss stays readable the same way a scalar mismatch does.
    return { ...claim, actualValue: JSON.stringify(actual), verification: 'unverified' }
  }

  const actualText = actual === null ? null : typeof actual === 'string' ? actual : JSON.stringify(actual)
  const matches = normalise(actual) === normalise(claim.claimedValue)

  return {
    ...claim,
    actualValue: actualText,
    verification: matches ? 'verified' : 'unverified',
  }
}
