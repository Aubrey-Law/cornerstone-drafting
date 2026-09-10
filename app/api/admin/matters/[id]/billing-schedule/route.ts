import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createFeeScheduleSchema, createMatterFeeSchedule } from '@/lib/billing/schedules'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const parsed = createFeeScheduleSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'A valid package and agreed fee are required' }, { status: 400 })
  try {
    const matterId = await resolveMatterId((await params).id, getAdminClient()).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!matterId) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    const schedule = await createMatterFeeSchedule({
      matterId,
      packageId: parsed.data.packageId,
      agreedTotalCents: parsed.data.agreedTotalCents,
      actorId: auth.userId!,
      manualMilestones: parsed.data.manualMilestones,
    })
    return NextResponse.json({ schedule }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create fee schedule' }, { status: 409 })
  }
}
