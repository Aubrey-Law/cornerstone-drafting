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

export interface ActionDefinition<Input = Record<string, unknown>, Result = unknown> {
  key: string
  risk: ActionRisk
  validate(input: unknown, actor: ActionActor): Input
  preview(input: Input, context: ActionExecutionContext): Promise<ActionPreview>
  execute(input: Input, context: ActionExecutionContext): Promise<Result>
  auditResult?(result: Result): Record<string, unknown> | null
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
}

export interface ActionExecutionRequest {
  confirmationDigest?: string
}
