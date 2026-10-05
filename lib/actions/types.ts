import type { SupabaseClient } from '@supabase/supabase-js'

export type ActionRisk =
  | 'read'
  | 'prepare'
  | 'internal_write'
  | 'external_write'
  | 'legal_financial'
  | 'prohibited'

export type ActionSource = 'api' | 'today' | 'record' | 'assistant' | 'automation'

export type ActionConfirmationPolicy = 'automatic' | 'one_click' | 'explicit' | 'never'

/**
 * The delegation dial. How far an unattended caller may take an action without
 * a person: record only, wait for a click, act and show it in the digest, or
 * act with the audit row as the only trace. Ordered from least to most.
 */
export type ActionAutonomy = 'observe' | 'propose' | 'act_report' | 'act_silent'

export interface ActionActor {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
}

export interface ActionExecutionContext {
  admin: SupabaseClient
  actor: ActionActor
  source: ActionSource
  idempotencyKey: string
}

/**
 * The display projection is returned to the authenticated user. Audit
 * projections are deliberately separate so message bodies and legal facts do
 * not leak into the execution log.
 */
export interface ActionPreview {
  display: Record<string, unknown>
  auditBefore: Record<string, unknown> | null
  auditAfter: Record<string, unknown> | null
}

/** What an undo has to work from: the audit projections recorded at execution. */
export interface ActionUndoRecord {
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
}

export interface ActionDefinition<Input = Record<string, unknown>, Result = unknown> {
  key: string
  risk: ActionRisk
  validate(input: unknown, actor: ActionActor): Input
  preview(input: Input, context: ActionExecutionContext): Promise<ActionPreview>
  execute(input: Input, context: ActionExecutionContext): Promise<Result>
  auditResult?(result: Result): Record<string, unknown> | null
  /**
   * Reverses a succeeded execution from its audit projections. Only actions
   * with a clean inverse define one; a sent email or a stage change does not.
   * Its presence is what lets the dial offer "Undo" on a delegated action.
   */
  undo?(input: Input, record: ActionUndoRecord, context: ActionExecutionContext): Promise<Record<string, unknown> | void>
}

export interface ActionProposalRequest {
  actionKey: string
  displaySummary: string
  referencePayload: Record<string, unknown>
  recordType?: 'lead' | 'matter' | 'firm'
  recordId?: string
  idempotencyKey?: string
  source?: ActionSource
  expiresAt?: string
  automationRunId?: string
  /**
   * Let the delegation dial decide whether this proposal waits for a click,
   * runs at once, or is only recorded. Unattended callers set it; a proposal
   * a person is about to accept leaves it unset and keeps today's behavior.
   */
  applyAutonomy?: boolean
  /** The most the caller itself allows, applied on top of the dial. */
  autonomyCeiling?: ActionAutonomy
}

export interface ActionExecutionRequest {
  confirmationDigest?: string
}
