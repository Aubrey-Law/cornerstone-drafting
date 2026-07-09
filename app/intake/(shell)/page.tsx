import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getOrCreateClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { type IntakeRow } from '@/lib/intakeSections'
import { getFirmConfig } from '@/lib/firmConfig'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import GuidedInterview from '@/components/intake/GuidedInterview'
import { RequestUnlockButton } from './RequestUnlockButton'

export const dynamic = 'force-dynamic'

const firm = getFirmConfig()

export default async function IntakeHomePage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const intake = await getOrCreateClientIntakeForUser(supabase, user)

  const intakeRow = (await hydrateIntakeWithContacts(
    supabase,
    intake as Record<string, unknown>,
    intake.id as string,
  )) as IntakeRow

  const submitted = intakeRow.status === 'submitted' || intakeRow.status === 'approved'

  if (submitted) {
    const firstName = (intakeRow.first_name as string) || null
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-amber-900 dark:text-amber-100">
                Thank you{firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200/90">
                We&apos;ve received your questionnaire. We look forward to reviewing it with you at our meeting.
                To request changes, email{' '}
                <a href={`mailto:${firm.email}`} className="underline">{firm.email}</a>.
              </p>
              <div className="mt-4">
                <RequestUnlockButton
                  requestedAt={(intakeRow.unlock_requested_at as string | null) ?? null}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <GuidedInterview
      initialData={intakeRow as Record<string, unknown>}
      intakeId={intake.id as string}
      mode="client"
    />
  )
}
