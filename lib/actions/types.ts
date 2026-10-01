import type { SupabaseClient } from '@supabase/supabase-js'

export type ActionRisk =
  | 'read'
  | 'prepare'
  | 'internal_write'
  | 'external_write'
  | 'legal_financial'
  | 'prohibited'

export interface ActionActor {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown>
}

export interface ActionExecutionContext {
  admin: SupabaseClient
  actor: ActionActor
}

export interface ActionDefinition<Input = Record<string, unknown>, Preview = Record<string, unknown>, Result = unknown> {
  key: string
  risk: ActionRisk
  validate(input: unknown): Input
  preview(input: Input, context: ActionExecutionContext): Promise<Preview>
  execute(input: Input, context: ActionExecutionContext): Promise<Result>
}

export interface ActionProposalRequest {
  actionKey: string
  displaySummary: string
  referencePayload: Record<string, unknown>
  recordType?: 'lead' | 'matter' | 'firm'
  recordId?: string
  idempotencyKey?: string
}
