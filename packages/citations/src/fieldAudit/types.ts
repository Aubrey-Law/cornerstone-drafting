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
