import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { ESTATE_PLANNING_SLA, generateMatterTasks } from '@/lib/slaTasks/generate'

/**
 * POST /api/matters/[matterId]/tasks/generate
 *
 * Instantiate an SLA template into dated tasks for this matter. Idempotent:
 * a matter that already has a checklist keeps it and comes back 200 with
 * `created: false`, unless `{ replace: true }` asks for a clean regeneration.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ matterId: string }> },
) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { matterId } = await params
  const body = (await req.json().catch(() => ({}))) as {
    template_name?: unknown
    start_date?: unknown
    replace?: unknown
  }

  const result = await generateMatterTasks(getAdminClient(), {
    matterId,
    templateName:
      typeof body.template_name === 'string' ? body.template_name : ESTATE_PLANNING_SLA,
    startDate: typeof body.start_date === 'string' ? body.start_date : undefined,
    replace: body.replace === true,
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json(
    { created: result.created, tasks: result.tasks },
    { status: result.created ? 201 : 200 },
  )
}
