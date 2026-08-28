import { z } from 'zod'

import { MIN_CLIENT_PASSWORD_LENGTH } from '@/lib/auth/clientPassword'

/** Password + confirmation, shared by both client-facing signup forms. */
const newPasswordFields = {
  password: z
    .string()
    .min(MIN_CLIENT_PASSWORD_LENGTH, `Use at least ${MIN_CLIENT_PASSWORD_LENGTH} characters.`),
  confirmPassword: z.string(),
}

/** Reports the mismatch on the confirmation field so it renders under that input. */
function requireMatchingPasswords(
  value: { password: string; confirmPassword: string },
  ctx: z.RefinementCtx,
) {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmPassword'],
      message: 'Passwords do not match.',
    })
  }
}

const emailField = z.string().min(1, 'Required').email('Enter a valid email address.')

/** Invite-token signup at /intake/auth. */
export const intakeSignupSchema = z
  .object({ email: emailField, ...newPasswordFields })
  .superRefine(requireMatchingPasswords)

export type IntakeSignupValues = z.infer<typeof intakeSignupSchema>

/**
 * Public self-registration at /intake/start. Turnstile only gates the form when
 * the widget is actually configured, so the schema is built per site key.
 */
export function publicIntakeStartSchema(requireTurnstile: boolean) {
  return z
    .object({
      fullName: z.string().trim().min(1, 'Required'),
      email: emailField,
      phone: z.string(),
      ...newPasswordFields,
      turnstileToken: requireTurnstile
        ? z.string().min(1, 'Complete the security check.')
        : z.string(),
    })
    .superRefine(requireMatchingPasswords)
}

export type PublicIntakeStartValues = z.infer<ReturnType<typeof publicIntakeStartSchema>>
