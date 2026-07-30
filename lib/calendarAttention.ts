import 'server-only'
import { computeDesignSheetReadiness } from '@/lib/designSheetReadiness'
import { getIntakeReadinessFlags } from '@/lib/intakeReadiness'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import { fetchDesignSheet, PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { fetchTasks } from '@/lib/queries/tasks'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey } from '@/lib/firmDate'
import { firmDateUtcSearchBounds } from '@/lib/utils'
import type { AttentionItem, CalendarRailData } from '@/app/admin/calendar/types'
import type { IntakeRow } from '@/lib/intakeSections'
import type { PipelineMatter } from '@/types/database'
import { deriveAppointmentAttention } from '@/lib/calendarProductivity'

interface AppointmentContext {
  id: string
  start_time: string
  end_time: string
  appointment_type_id: string
  attendee_name: string
  linked_matter_id: string | null
  linked_lead_id: string | null
}

export async function deriveCalendarAttention(dateKey: string): Promise<{
  items: AttentionItem[]
  rail: CalendarRailData
}> {
  const admin = getAdminClient()
  const { from, to } = firmDateUtcSearchBounds(dateKey)
  const [appointmentsResult, typesResult, mattersResult, tasks] = await Promise.all([
    admin
      .from('appointments')
      .select('id, start_time, end_time, appointment_type_id, attendee_name, linked_matter_id, linked_lead_id')
      .gte('start_time', from)
      .lt('start_time', to)
      .eq('status', 'scheduled'),
    admin.from('appointment_types').select('id, label'),
    admin.from('v_matter_pipeline').select(PIPELINE_MATTER_COLUMNS).neq('status', 'archived'),
    fetchTasks({ status: 'open', limit: 500 }),
  ])
  const appointments = ((appointmentsResult.data ?? []) as AppointmentContext[])
    .filter(item => firmDateKey(item.start_time) === dateKey)
  const typeById = new Map(
    ((typesResult.data ?? []) as Array<{ id: string; label: string }>).map(row => [row.id, row.label]),
  )
  const matters = (mattersResult.data ?? []) as PipelineMatter[]
  const matterById = new Map(matters.map(matter => [matter.matter_id, matter]))
  const matterIds = [...new Set(appointments
    .map(item => item.linked_matter_id)
    .filter((id): id is string => Boolean(id)))]

  const [matterRowsResult, activityResult] = await Promise.all([
    matterIds.length
      ? admin.from('matters').select('id, client_intake_id').in('id', matterIds)
      : Promise.resolve({ data: [] }),
    matterIds.length
      ? admin.from('matter_activity').select('matter_id, event_type, created_at').in('matter_id', matterIds)
      : Promise.resolve({ data: [] }),
  ])
  const intakeIdByMatter = new Map(
    ((matterRowsResult.data ?? []) as Array<{ id: string; client_intake_id: string | null }>)
      .map(row => [row.id, row.client_intake_id]),
  )
  const intakeIds = [...new Set([...intakeIdByMatter.values()].filter((id): id is string => Boolean(id)))]
  const intakeResult = intakeIds.length
    ? await admin.from('client_intake').select('*').in('id', intakeIds)
    : { data: [] }
  const intakeById = new Map(
    ((intakeResult.data ?? []) as Array<Record<string, unknown> & { id: string }>).map(row => [row.id, row]),
  )
  const activityByMatter = new Map<string, Array<{ event_type: string; created_at: string }>>()
  for (const row of (activityResult.data ?? []) as Array<{ matter_id: string; event_type: string; created_at: string }>) {
    activityByMatter.set(row.matter_id, [...(activityByMatter.get(row.matter_id) ?? []), row])
  }

  const items: AttentionItem[] = []
  const now = Date.now()
  for (const appointment of appointments) {
    const matterId = appointment.linked_matter_id
    if (!matterId) continue
    const matter = matterById.get(matterId)
    if (!matter) continue
    const typeLabel = typeById.get(appointment.appointment_type_id) ?? 'Appointment'
    const startsInHours = (Date.parse(appointment.start_time) - now) / 3_600_000
    const intakeId = intakeIdByMatter.get(matterId)
    const intake = intakeId ? intakeById.get(intakeId) : null
    const intakeFlags = intake ? getIntakeReadinessFlags(intake as unknown as IntakeRow) : []

    let designUnapproved = false
    let designBlockingCount = 0
    const sheet = await fetchDesignSheet(matterId)
    if (sheet) {
      const readiness = computeDesignSheetReadiness({
        sheet,
        matter: { has_minor_children: matter.has_minor_children },
        isLP: false,
        lpData: null,
      })
      designUnapproved = sheet.status !== 'ready' || !readiness.complete
      designBlockingCount = readiness.blocking.length
    }

    const signingTasks = /signing/i.test(typeLabel)
      ? tasks.filter(task =>
        task.matter_id === matterId
        && (task.status === 'blocked' || /sign|witness|notary|third party/i.test(task.title)),
      )
      : []
    let followUpOwed = false
    let nextAction: { label: string; href: string } | null = null
    if (Date.parse(appointment.end_time) < now) {
      const recentActivity = (activityByMatter.get(matterId) ?? [])
        .some(row => Date.parse(row.created_at) >= Date.parse(appointment.end_time))
      const next = computeMatterNextAction(matter)
      if (!recentActivity && next.kind !== 'waiting-intake' && next.kind !== 'waiting-engagement') {
        followUpOwed = true
        nextAction = { label: next.cta, href: next.href }
      }
    }
    items.push(...deriveAppointmentAttention({
      appointmentId: appointment.id,
      attendeeName: appointment.attendee_name,
      typeLabel,
      matterId,
      startsInHours,
      intakeFlagCount: intakeFlags.length,
      designUnapproved,
      designBlockingCount,
      signingTaskCount: signingTasks.length,
      followUpOwed,
      nextAction,
    }))
  }

  const datesThisWeek = matters
    .filter(matter => matter.signing_date && matter.signing_date >= dateKey)
    .slice(0, 8)
    .map(matter => ({
      id: `${matter.matter_id}:signing`,
      label: `Signing · ${matter.client_name ?? matter.matter_name ?? 'Matter'}`,
      date: matter.signing_date as string,
      matterId: matter.matter_id,
    }))
  const followUps = tasks
    .filter(task => /follow.?up|call|email|note/i.test(task.title))
    .slice(0, 8)
    .map(task => ({
      id: task.id,
      title: task.title,
      matterId: task.matter_id,
      leadId: task.lead_id,
    }))

  return { items, rail: { datesThisWeek, followUps, openSlots: [] } }
}
