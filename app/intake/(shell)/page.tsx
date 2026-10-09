import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createServerSupabase } from '@/lib/supabaseServer'
import { getOrCreateClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { type IntakeRow } from '@/lib/intakeSections'
import { getFirmConfig } from '@/lib/firmConfig'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { resolveIntakeDelivery } from '@/lib/intake/forms/runtime'
import GuidedInterview from '@/components/intake/GuidedInterview'
import { RequestUnlockButton } from './RequestUnlockButton'
import { OtherFormsNotice, countOtherOpenForms } from './OtherFormsNotice'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const dynamic = 'force-dynamic'

const firm = getFirmConfig()

export default async function IntakeHomePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // ?id= picks one of several questionnaires this person holds (see /forms).
  const requestedId = (await searchParams)?.id
  const intake = await getOrCreateClientIntakeForUser(supabase, user, requestedId && UUID.test(requestedId) ? requestedId : null)
  const otherForms = <OtherFormsNotice count={await countOtherOpenForms(user.id, intake.id as string)} />

  const submitted =
    intake.status === 'submitted' || intake.status === 'approved'

  // The thank-you screen only needs core intake columns; skip contact hydration
  // after submit so a transient contacts/roles read cannot break the page refresh.
  let intakeRow = intake as IntakeRow
  if (!submitted) {
    try {
      intakeRow = (await hydrateIntakeWithContacts(
        supabase,
        intake as Record<string, unknown>,
        intake.id as string,
      )) as IntakeRow
    } catch (error) {
      console.error('[intake page] contact hydration failed:', error)
      if (intake.form_version_id) return <p role="alert">This questionnaire is temporarily unavailable. Please contact the firm.</p>
    }
  }

  if (submitted) {
    const firstName = (intakeRow.first_name as string) || null
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-xl border border-amber-border bg-amber-bg p-6">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-amber">
                Thank you{firstName ? `, ${firstName}` : ''}
              </h1>
              <p className="mt-1 text-sm text-amber">
                We&apos;ve received your questionnaire. We look forward to reviewing it with you at our meeting.
                To request changes, email{' '}
                <a href={`mailto:${firm.email}`} className="underline">{firm.email}</a>.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <RequestUnlockButton
                  intakeId={intake.id as string}
                  requestedAt={(intakeRow.unlock_requested_at as string | null) ?? null}
                />
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard">Back to portal</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
        {otherForms}
      </div>
    )
  }

  try {
    const delivery = await resolveIntakeDelivery(intake, 'client', process.env)
    return (
      <>
      {otherForms}
      <GuidedInterview
        initialData={intakeRow as Record<string, unknown>}
        intakeId={intake.id as string}
        mode="client"
        {...delivery}
      />
      </>
    )
  } catch (error) {
    console.error('Intake form unavailable', error)
    return <p role="alert">This questionnaire is temporarily unavailable. Please contact the firm.</p>
  }
}
