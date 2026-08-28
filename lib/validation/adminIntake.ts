import { z } from 'zod'

import type { AdminIntakeFormData } from '@/types/adminIntake'

/**
 * Submit-time rules for the attorney-authored intake sheet.
 *
 * The shape of the data is already guaranteed by `AdminIntakeFormData`, so this
 * starts from `z.custom` rather than restating ninety fields that would then
 * have to be kept in sync. What it adds is the handful of business rules that
 * block "Submit intake" — saving a draft deliberately runs none of them.
 *
 * The College Preparation Plan track hides marital status and assets, so
 * requiring them there would leave the attorney with errors pointing at fields
 * that are not on screen.
 */
export function adminIntakeSubmitSchema({ isCollegePrep }: { isCollegePrep: boolean }) {
  return z.custom<AdminIntakeFormData>().superRefine((value, ctx) => {
    const required: Array<keyof AdminIntakeFormData> = ['first_name', 'last_name', 'email']
    for (const field of required) {
      if (!String(value[field] ?? '').trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Required' })
      }
    }

    if (isCollegePrep) return

    if (!value.marital_status) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['marital_status'],
        message: 'Required',
      })
    }

    const hasAsset =
      value.has_real_property ||
      value.has_retirement ||
      value.has_investments ||
      value.has_business ||
      value.has_life_insurance ||
      Boolean(value.estate_value)
    if (!hasAsset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estate_value'],
        message: 'At least one asset field is required',
      })
    }
  })
}
