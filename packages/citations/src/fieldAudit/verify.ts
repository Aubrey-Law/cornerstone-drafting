import type { FieldReference, FieldReferenceClaim } from './types'

/** Whitespace and case are presentation, not substance. Nothing else is folded. */
function normalise(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Appends a key to a path, dotted unless the path is still empty. */
function joinKey(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}

interface Leaf {
  /** Dotted/indexed path from the field itself, e.g. `children[0].dob`. */
  path: string
  value: unknown
}

/**
 * Every scalar (string, number, boolean) reachable inside a structured value,
 * paired with the path that reaches it — in the raw form it actually holds,
 * not yet normalised, so a caller can still report the exact leaf that
 * matched and where it lives.
 *
 * `path` starts at `rootPath` (the field key) and grows by `.key` for an
 * object member or `[i]` for an array element as the walk descends, so the
 * path handed back is ready to show a person, not just an offset into this
 * function's own recursion.
 *
 * `null` entries inside the structure (an asset with a blank `value`, say)
 * are not collected: they are not a fact a claim can point at, and a claim of
 * `null` is handled separately as a claim about the whole structure being
 * empty, not about one of its fields being blank.
 */
/**
 * Every scalar inside a value, with the path that reaches it.
 *
 * Exported because the audit prompt shows the model these same leaves. What a
 * model is shown and what the verifier will accept have to be one list: the
 * document path learned this the same way, numbering the blocks the verifier
 * scopes by so the citation hint is not noise. Two functions that agreed only
 * by care would drift, and the drift would look like a model that cannot
 * quote.
 */
export function collectLeaves(value: unknown, rootPath: string, out: Leaf[] = []): Leaf[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectLeaves(item, `${rootPath}[${i}]`, out))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      collectLeaves(entry, joinKey(rootPath, key), out)
    }
  } else if (value !== null && value !== undefined) {
    out.push({ path: rootPath, value })
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
/**
 * Whether a claim quotes this text, by the rule the document verifier uses:
 * is it in there, exactly once?
 *
 * A design-sheet field like `concerns` holds a paragraph in the client's own
 * words, and a finding rests on one sentence of it. Demanding the whole field
 * back would be stricter than anything asked of a document citation, and it
 * would fail every claim that did the right thing. Uniqueness is what keeps
 * that honest: a phrase occurring twice cannot say which occurrence it means,
 * so it is refused rather than guessed at — the same reason `verifyQuote`
 * treats an ambiguous quote as no citation at all.
 */
function quotesText(actual: string, claimed: string): boolean {
  const haystack = normalise(actual)
  const needle = normalise(claimed)
  if (needle.length === 0 || haystack.length === 0) return false
  if (haystack === needle) return true

  let hits = 0
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    hits += 1
    if (hits > 1) return false
  }
  return hits === 1
}

export function verifyFieldReference(
  values: Record<string, unknown>,
  reads: string[],
  claim: FieldReferenceClaim,
): FieldReference {
  if (!reads.includes(claim.fieldKey)) {
    return { ...claim, actualValue: null, matchedPath: null, verification: 'unverified' }
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
    return { ...claim, actualValue: null, matchedPath: null, verification: 'unverified' }
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
        matchedPath: null,
        verification: empty ? 'verified' : 'unverified',
      }
    }

    const claimedNorm = normalise(claim.claimedValue)
    // More than one leaf can equal the claim (two children could share a
    // name). That is verified against the first match — there is no
    // ambiguity state, only the plain fact that a leaf equalling the claim
    // was found — and `matchedPath` names that first leaf.
    const matchedLeaf = collectLeaves(actual, claim.fieldKey).find(leaf => normalise(leaf.value) === claimedNorm)

    if (matchedLeaf !== undefined) {
      return {
        ...claim,
        actualValue: typeof matchedLeaf.value === 'string' ? matchedLeaf.value : JSON.stringify(matchedLeaf.value),
        matchedPath: matchedLeaf.path,
        verification: 'verified',
      }
    }

    // Nothing inside matched. The whole structure is recorded, not nothing,
    // so the near miss stays readable the same way a scalar mismatch does.
    return { ...claim, actualValue: JSON.stringify(actual), matchedPath: null, verification: 'unverified' }
  }

  const actualText = actual === null ? null : typeof actual === 'string' ? actual : JSON.stringify(actual)
  const matches =
    normalise(actual) === normalise(claim.claimedValue) ||
    (typeof actual === 'string' &&
      claim.claimedValue !== null &&
      quotesText(actual, claim.claimedValue))

  return {
    ...claim,
    actualValue: actualText,
    // A scalar field's path is just the field itself — recording it would
    // add nothing a reader doesn't already know from `fieldKey`.
    matchedPath: null,
    verification: matches ? 'verified' : 'unverified',
  }
}
