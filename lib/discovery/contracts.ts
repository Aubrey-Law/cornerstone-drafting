import { z } from 'zod'
import { DISCOVERY_FIELD_IDS, discoveryFieldError, type DiscoveryFieldId } from './catalog'
export const storedAnswersSchema = z.record(z.union([z.string().max(10000), z.array(z.string()).max(50), z.null()]))
export const answersSchema = storedAnswersSchema.superRefine((answers, ctx) => {
  for (const [id, value] of Object.entries(answers)) {
    if (!DISCOVERY_FIELD_IDS.includes(id as DiscoveryFieldId)) { ctx.addIssue({ code: 'custom', path: [id], message: 'Unknown discovery field' }); continue }
    const message = discoveryFieldError(id as DiscoveryFieldId, value)
    if (message) ctx.addIssue({ code: 'custom', path: [id], message })
  }
})
export type DiscoveryAnswers = z.infer<typeof answersSchema>
export const callSchema = z.object({
  id: z.string().uuid(), lead_id: z.string().uuid(), form_version_id: z.string().uuid(), status: z.enum(['draft','completed']),
  answers: storedAnswersSchema, revision: z.number().int().nonnegative(), summary: z.string().nullable(),
  created_by: z.string().uuid(), updated_by: z.string().uuid(), created_at: z.string(), updated_at: z.string(), completed_at: z.string().nullable(), activity_id: z.string().uuid().nullable(),
}).strict()
export type DiscoveryCall = z.infer<typeof callSchema>
export const saveSchema = z.object({ revision: z.number().int().nonnegative(), answers: storedAnswersSchema }).strict()
export const amendmentSchema = z.object({ body: z.string().trim().min(1).max(10000) }).strict()
export const amendmentRowSchema = z.object({ id: z.string().uuid(), call_id: z.string().uuid(), body: z.string(), actor_id: z.string().uuid(), created_at: z.string() }).strict()
