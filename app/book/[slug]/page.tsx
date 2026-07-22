import { notFound } from 'next/navigation'
import BookingWidget from '@/components/scheduling/BookingWidget'
import { getAppointmentTypeBySlug } from '@/lib/appointments/settings'
import { getFirmConfig } from '@/lib/firmConfig'
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {firm.firmName}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">{type.label}</h1>
      {type.description && (
        <p className="mt-1 text-sm text-muted-foreground">{type.description}</p>
      )}
      <div className="mt-8">
        <BookingWidget
          type={{
            key: type.key,
            slug: type.slug,
            label: type.label,
            description: type.description,
            durationMinutes: type.durationMinutes,
            locationType: type.locationType,
          }}
        />
      </div>
    </div>
  )
}
