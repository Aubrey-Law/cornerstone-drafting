import { NextResponse } from 'next/server'
import { listAppointmentTypes } from '@/lib/appointments/settings'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'
import { getCachedClaims } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Active appointment types. Anonymous callers only see public types;
 * signed-in users (portal clients) also see portal-only types.
 */
export async function GET(req: Request) {
  const limited = await guardPublicSchedulingRoute(req, 'scheduling_types', 30)
  if (limited) return limited

  const claims = await getCachedClaims()
  const types = (await listAppointmentTypes()).filter(
    t => t.active && (t.public || Boolean(claims)),
  )

  return NextResponse.json({
    types: types.map(t => ({
      key: t.key,
      slug: t.slug,
      label: t.label,
      description: t.description,
      durationMinutes: t.durationMinutes,
      locationType: t.locationType,
      public: t.public,
    })),
  })
}
