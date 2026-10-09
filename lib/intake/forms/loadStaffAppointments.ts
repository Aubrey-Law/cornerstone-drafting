import type { getAdminClient } from '@/lib/supabaseAdmin'
import { appointmentSnapshotSchema, STAFF_APPOINTMENT_BLOCKS, type StaffAppointmentData } from './staffAppointments'

/** Caller supplies an authorized client. Matter membership scopes appointments. */
export async function withStaffAppointments(admin: ReturnType<typeof getAdminClient>, intake: Record<string, unknown>, staffSnapshots = true) {
  const intakeId = String(intake.id)
  const { data: matters, error: matterError } = await admin.from('matters').select('id').eq('client_intake_id', intakeId)
  if (matterError) throw new Error(matterError.message)
  if ((matters?.length ?? 0) > 1) throw new Error('Multiple matters use this questionnaire. Review the matter links before editing appointments.')
  const matterId = matters?.[0]?.id ?? null
  let roleQuery = admin.from('contact_roles').select('id,contact_id,role,for_party,priority,is_coagent')
  roleQuery = matterId ? roleQuery.eq('matter_id', matterId) : roleQuery.is('matter_id', null).eq('client_intake_id', intakeId)
  const { data: rows, error: roleError } = await roleQuery
  if (roleError) throw new Error(roleError.message)
  const roles = (rows ?? []).map(row => appointmentSnapshotSchema.parse(row))
  let contactQuery = admin.from('contacts').select('*').is('merged_into_id', null)
  if (matterId) {
    const { data: joins, error: joinError } = await admin.from('matter_contacts').select('contact_id').eq('matter_id', matterId)
    if (joinError) throw new Error(joinError.message)
    const ids = [...new Set([...(joins ?? []).map(row => row.contact_id), ...roles.map(row => row.contact_id)])]
    // Include existing appointees for review even if their membership needs repair.
    contactQuery = contactQuery.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
    const { data: contacts, error } = await contactQuery
    if (error) throw new Error(error.message)
    return project(intake, matterId, roles, contacts ?? [], new Set((joins ?? []).map(row => row.contact_id)), staffSnapshots)
  }
  const { data: contacts, error } = await contactQuery.eq('client_intake_id', intakeId)
  if (error) throw new Error(error.message)
  return project(intake, null, roles, contacts ?? [], new Set((contacts ?? []).map(row => row.id)), staffSnapshots)
}

function project(intake: Record<string, unknown>, matterId: string | null, roles: StaffAppointmentData['roles'], contacts: Record<string, unknown>[], eligible: Set<string>, staffSnapshots: boolean) {
  const out = { ...intake }
  const people = new Map(contacts.map(row => [String(row.id), row]))
  for (const pairs of Object.values(STAFF_APPOINTMENT_BLOCKS)) for (const [role, party] of pairs) {
    out[`_fid_${role}_${party}`] = roles.filter(row => row.role === role && row.for_party === party)
      .sort((a, b) => a.priority - b.priority || Number(a.is_coagent) - Number(b.is_coagent))
      .map(row => {
        const person = people.get(row.contact_id) ?? {}
        return Object.fromEntries([
          ...['first_name','middle_name','last_name','suffix','preferred_pronoun','email','phone','city','state','zip'].map(key => [key, person[key] ?? '']),
          ['street', person.address_line1 ?? ''], ['relationship', person.relationship_label ?? person.relationship_type ?? ''],
          ['contact_id', row.contact_id], ['priority', row.priority], ['is_coagent', row.is_coagent],
        ])
      })
  }
  if (staffSnapshots) out._staff_appointments = { matterId, roles, contacts: contacts.filter(row => eligible.has(String(row.id)) && row.source !== 'client_intake_additional_removed')
    .map(row => ({ id: String(row.id), name: [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(' ') || 'Unnamed contact' })) } satisfies StaffAppointmentData
  return out
}
