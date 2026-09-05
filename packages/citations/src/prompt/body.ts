import { z } from 'zod'
import { reviewRuleSchema } from '../review/types'

/**
 * What a prompt is, in two arms.
 *
 * Discriminated on `kind` rather than validated by convention, because the two
 * bodies have nothing in common beyond their inputs and the database enforces
 * the same split with a composite foreign key. A schema that accepted either
 * shape under either name would leave that constraint as the only thing
 * catching a mistake, and it would catch it at insert time rather than while
 * someone is writing the prompt.
 */
export const promptInputSchema = z.object({
  key: z.string().min(1),
  /** A dotted path checked against the allow-list in ./inputs at publish time. */
  source: z.string().min(1),
  required: z.boolean(),
})

export const fieldAuditCheckSchema = z.object({
  number: z.string().min(1),
  statement: z.string().min(1),
  risk: z.enum(['blocker', 'high', 'medium', 'low']),
  /**
   * The design-sheet fields this check may consult, and the only ones its
   * references may name. A check with none could produce no verifiable
   * reference, so its findings could never become tasks — which makes it a
   * check that cannot act, not a lenient one.
   */
  reads: z.array(z.string().min(1)).min(1),
  taskTemplate: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(['low', 'normal', 'high']),
  }),
})

export const reviewBodySchema = z.object({
  kind: z.literal('review'),
  inputs: z.array(promptInputSchema),
  rules: z.array(reviewRuleSchema).min(1),
})

export const fieldAuditBodySchema = z.object({
  kind: z.literal('field_audit'),
  inputs: z.array(promptInputSchema),
  checks: z.array(fieldAuditCheckSchema).min(1),
})

export const promptBodySchema = z.discriminatedUnion('kind', [
  reviewBodySchema,
  fieldAuditBodySchema,
])

export type PromptKind = z.infer<typeof promptBodySchema>['kind']
export type PromptBody = z.infer<typeof promptBodySchema>
export type FieldAuditBody = z.infer<typeof fieldAuditBodySchema>
export type FieldAuditCheck = z.infer<typeof fieldAuditCheckSchema>
export type PromptInput = z.infer<typeof promptInputSchema>
