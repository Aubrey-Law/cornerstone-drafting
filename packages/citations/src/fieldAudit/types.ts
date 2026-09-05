export type FieldVerification = 'verified' | 'unverified' | 'stale'

export interface FieldReferenceClaim {
  fieldKey: string
  /** What the model says the field holds. Null claims the field is empty. */
  claimedValue: string | null
}

export interface FieldReference extends FieldReferenceClaim {
  /** What the field actually holds. Null when the field was out of scope. */
  actualValue: string | null
  verification: FieldVerification
  /**
   * The dotted/indexed path to the leaf inside the field that satisfied the
   * claim — e.g. `children[0].dob`, `assets[0].description`.
   *
   * A reference exists to say which fact a finding rests on, and for a
   * structured (jsonb array-of-objects) field the field name alone does not
   * say that: `verifyFieldReference` matches a claim against *any* scalar
   * leaf reachable inside the value, and a leaf carries no record of which
   * object it belonged to. A date that really is in `children` can be
   * matched by a claim that attaches it to the wrong child, and the verifier
   * cannot tell — flattening to leaves is what makes a structured field
   * citeable at all, and it is also what erases provenance within it. This
   * path is what lets a person reading the finding see which record a value
   * actually came from and catch that misattribution themselves.
   *
   * `null` for a scalar field (the path would just be the field itself, and
   * adds nothing), for an emptiness claim, and whenever verification failed.
   */
  matchedPath: string | null
}

export type FieldAuditOutcome = 'compliant' | 'deviation' | 'absent' | 'not_applicable'

export interface FieldAuditFinding {
  checkNumber: string
  outcome: FieldAuditOutcome
  severity: 'blocker' | 'high' | 'medium' | 'low' | null
  rationale: string
  references: FieldReference[]
}

export interface FieldAuditResult {
  promptSlug: string
  promptVersion: number
  findings: FieldAuditFinding[]
  /** Checks whose model call failed outright. The audit continues without them. */
  failures: Array<{ checkNumber: string; reason: string }>
}
