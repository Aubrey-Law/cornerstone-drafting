import { redirect } from 'next/navigation'
import { getAppointmentTypesForPortal } from '@/lib/appointments/portalTypes'
import { findClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { createServerSupabase, getCachedClaims } from '@/lib/supabaseServer'
import { loadFirmSettings } from '@/lib/firmSettings'
import { firmOfficeAddress } from '@/lib/appointments/officeAddress'
import SchedulePageClient from './SchedulePageClient'
import { PortalPageHeader } from '../PortalPageHeader'

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
  const officeAddress = firmOfficeAddress(await loadFirmSettings())

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PortalPageHeader
        title="Schedule"
        description="Book an appointment. Pick a time that works for you — only openings on our calendar are shown."
      />
      <SchedulePageClient
        types={types}
        defaultFirstName={firstName || (!lastName ? historicalName : '')}
        defaultLastName={lastName}
        defaultEmail={auth.email ?? ''}
        defaultPhone={phone}
        officeAddress={officeAddress}
      />
    </div>
  )
}
