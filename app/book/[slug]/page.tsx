import { clientSerifClass } from '@/lib/clientFonts'
import { notFound } from 'next/navigation'
import BookingWidget from '@/components/scheduling/BookingWidget'
import { getAppointmentTypeBySlug } from '@/lib/appointments/settings'
import { getFirmConfig } from '@/lib/firmConfig'
import { loadFirmSettings } from '@/lib/firmSettings'
import { firmOfficeAddress } from '@/lib/appointments/officeAddress'
import { getCachedClaims } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const type = await getAppointmentTypeBySlug(slug)
  if (!type || !type.active) notFound()

  // Portal-only types are reachable at /book/[slug] only with a session.
  if (!type.public) {
    const claims = await getCachedClaims()
    if (!claims) notFound()
  }

  const firm = getFirmConfig()
  const officeAddress = firmOfficeAddress(await loadFirmSettings())

  return (
    <div className={`client-root client-booking min-h-dvh bg-background ${clientSerifClass}`}>
      <main className="mx-auto flex max-w-[1144px] flex-col items-center md:px-8 md:py-14">
        <div className="w-full">
          <BookingWidget
            standalone
            firmName={firm.firmName}
            officeAddress={officeAddress}
            type={{
              key: type.key,
              slug: type.slug,
              label: type.label,
              description: type.description,
              durationMinutes: type.durationMinutes,
              locationType: type.locationType,
              locationTypes: type.locationTypes,
              bookingQuestions: type.bookingQuestions,
            }}
          />
        </div>
        <p className="mt-5 mb-8 px-5 text-center text-compact text-muted-foreground">
          Need help? Call {firm.firmName} at{' '}
          <a
            className="font-medium underline-offset-4 hover:underline"
            href={`tel:${firm.phone.replace(/[^\d+]/g, '')}`}
          >
            {firm.phone}
          </a>{' '}
          and we&apos;ll schedule for you.
        </p>
      </main>
    </div>
  )
}
