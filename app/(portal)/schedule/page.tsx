import { redirect } from 'next/navigation'
import { getAppointmentTypesForPortal } from '@/lib/appointments/portalTypes'
import { findClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { createServerSupabase, getCachedClaims } from '@/lib/supabaseServer'
import SchedulePageClient from './SchedulePageClient'

export const dynamic = 'force-dynamic'

export default async function PortalSchedulePage() {
  const auth = await getCachedClaims()
  if (!auth) redirect('/auth/login')

  const supabase = await createServerSupabase()
  const intake = await findClientIntakeForUser(supabase, auth.id)

  const firstName = (intake?.first_name as string | null | undefined) ?? ''
  const lastName = (intake?.last_name as string | null | undefined) ?? ''
  const phone = (intake?.phone as string | null | undefined) ?? ''
  const historicalName = typeof intake?.full_name === 'string' ? intake.full_name : ''

  const types = await getAppointmentTypesForPortal()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Client portal
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">Schedule an appointment</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a time that works for you — only openings on our calendar are shown.
      </p>
      <div className="mt-8">
        <SchedulePageClient
          types={types}
          defaultFirstName={firstName || (!lastName ? historicalName : '')}
          defaultLastName={lastName}
          defaultEmail={auth.email ?? ''}
          defaultPhone={phone}
        />
      </div>
    </div>
  )
}
