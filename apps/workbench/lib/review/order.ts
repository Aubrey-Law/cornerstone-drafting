import type { ReviewFinding } from '@aubrey-law/citations/review/types'

/**
 * The order the attorney works in.
 *
 * This is a product decision rather than presentation: what stops the document
 * going anywhere comes first. Within that, an absence ranks by its own
 * severity rather than below every deviation — absence is the finding a review
 * exists to catch, because a rule like "the indemnity must be mutual" is
 * answered by the document not saying something.
 */
const OUTCOME_RANK: Record<ReviewFinding['outcome'], number> = {
  deviation: 0,
  absent: 0,
  compliant: 1,
  not_applicable: 2,
}

const SEVERITY_RANK: Record<NonNullable<ReviewFinding['severity']>, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/** Numeric where possible, so rule 10 sorts after rule 2 rather than before it. */
function ruleOrder(ruleNumber: string): [number, string] {
  const leading = Number.parseInt(ruleNumber, 10)
  return [Number.isNaN(leading) ? Number.MAX_SAFE_INTEGER : leading, ruleNumber]
}

export function orderFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => {
    const outcome = OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome]
    if (outcome !== 0) return outcome

    const severity =
      (a.severity ? SEVERITY_RANK[a.severity] : Number.MAX_SAFE_INTEGER) -
      (b.severity ? SEVERITY_RANK[b.severity] : Number.MAX_SAFE_INTEGER)
    if (severity !== 0) return severity

    const [aNum, aRaw] = ruleOrder(a.ruleNumber)
    const [bNum, bRaw] = ruleOrder(b.ruleNumber)
    return aNum - bNum || aRaw.localeCompare(bRaw)
  })
}

/**
 * Whether this finding may point at the document.
 *
 * The single gate, rather than a check repeated wherever a citation is shown or
 * exported. Anything that is not a verified citation is a claim the document
 * has not been shown to support.
 */
export function isCitable(finding: ReviewFinding): boolean {
  return finding.citation !== null && finding.citation.verification === 'verified'
}
