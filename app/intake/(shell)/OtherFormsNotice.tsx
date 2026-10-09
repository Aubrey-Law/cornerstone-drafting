import Link from 'next/link'
import { listPortalForms } from '@/lib/forms/portalForms'

/**
 * How many other questionnaires and forms this person still has open. Any
 * failure reads as none: the pointer must never block the intake itself.
 */
export async function countOtherOpenForms(userId: string, currentIntakeId: string): Promise<number> {
  try {
    const { questionnaires, forms } = await listPortalForms(userId)
    return questionnaires.filter(item => item.intakeId !== currentIntakeId && item.status !== 'submitted').length
      + forms.filter(item => item.status !== 'submitted').length
  } catch {
    return 0
  }
}

/** A one-line pointer to /forms, shown above the questionnaire the client is in. */
export function OtherFormsNotice({ count }: { count: number }) {
  if (!count) return null
  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
      <p className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
        You have {count} other {count === 1 ? 'form' : 'forms'} to fill out.{' '}
        <Link href="/forms" className="font-medium text-foreground underline">See all forms</Link>
      </p>
    </div>
  )
}
