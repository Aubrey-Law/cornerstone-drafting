import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { calculateMAEstateTax } from '@/lib/estateTax'
import { fetchTasksForMatter } from '@/lib/queries/tasks'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { stageLabel, type MatterStage } from '@/types/database'
import { getCalendarEventAttendees } from '@/lib/appointments/graphEvents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function numericEstate(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return 0
  const parsed = Number(value.replace(/[$,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  const admin = getAdminClient()
  const { data: appointment, error } = await admin
    .from('appointments')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })

  const matterId = appointment.linked_matter_id as string | null
  let graphAttendees: Awaited<ReturnType<typeof getCalendarEventAttendees>> = []
  if (appointment.microsoft_event_id) {
    try {
      graphAttendees = await getCalendarEventAttendees(appointment.microsoft_event_id)
    } catch {
      // Outlook connection failures leave the local invite data usable.
    }
  }
  const localAttendees = [
    { name: appointment.attendee_name, email: appointment.attendee_email, status: 'invited' },
    ...(appointment.second_attendee_email ? [{
      name: appointment.second_attendee_name ?? appointment.second_attendee_email,
      email: appointment.second_attendee_email,
      status: 'invited',
    }] : []),
  ]
  const attendees = graphAttendees.length > 0 ? graphAttendees : localAttendees
  if (!matterId) {
    return NextResponse.json({
      appointment,
      matter: null,
      checklist: [],
      documents: [],
      attendees,
    })
  }

  const [matterResult, detailsResult, activityResult, documentsResult, tasks] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id, matter_name, client_name, stage, plan_type, taxable_estate')
      .eq('matter_id', matterId)
      .maybeSingle(),
    admin.from('matter_details').select('*').eq('client_id', matterId).maybeSingle(),
    admin.from('matter_activity').select('title, created_at').eq('matter_id', matterId).order('created_at', { ascending: false }).limit(1),
    admin
      .from('matter_documents')
      .select('id, name, folder, created_at, generation_id')
      .eq('matter_id', matterId)
      .is('superseded_at', null)
      .order('created_at', { ascending: false })
      .limit(8),
    fetchTasksForMatter(matterId, 'open'),
  ])
  const pipeline = matterResult.data
  const estate = numericEstate(pipeline?.taxable_estate)
  return NextResponse.json({
    appointment,
    matter: pipeline ? {
      id: matterId,
      name: pipeline.client_name ?? pipeline.matter_name,
      number: detailsResult.data?.matter_number ?? null,
      stage: pipeline.stage,
      stageLabel: stageLabel(pipeline.stage as MatterStage),
      planType: pipeline.plan_type,
      estate,
      maTaxExposure: calculateMAEstateTax(estate),
      lastTouch: activityResult.data?.[0] ?? null,
    } : null,
    checklist: tasks.slice(0, 8).map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      blocker: task.status === 'blocked',
    })),
    documents: documentsResult.data ?? [],
    attendees,
  })
}
