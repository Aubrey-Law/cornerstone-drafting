import { z } from 'zod'
import { splitName } from '@/lib/contacts/childName'

export const STAFF_APPOINTMENT_BLOCKS = {
  client_fiduciaries: [['trustee', 'client'], ['personal_rep', 'client'], ['poa', 'client'], ['hcp', 'client']],
  spouse_fiduciaries: [['personal_rep', 'spouse'], ['poa', 'spouse'], ['hcp', 'spouse']],
  guardian: [['guardian', 'client']],
  college_agents: [['poa', 'client'], ['hcp', 'client']],
} as const
export const APPOINTMENT_LABELS: Record<string, string> = { trustee: 'Trustee', personal_rep: 'Personal representative', poa: 'Financial power of attorney', hcp: 'Health care proxy', guardian: 'Guardian' }
export const APPOINTMENT_CHOICE_KEYS = { client_fiduciaries: 'fiduciaries', spouse_fiduciaries: 'spouse_fiduciaries', guardian: 'guardian', college_agents: 'cp_agents' } as const
export function parseStaffAppointmentChoice(value: unknown) {
  const parsed = z.object({ reviewChoice: z.enum(['', 'discuss_with_attorney', 'not_provided_yet']) }).strict().safeParse(value)
  if (!parsed.success) throw new Error('Select a valid appointment review choice.')
  return parsed.data.reviewChoice
}
export function mergeExcludedGuardians(value: unknown, stored: unknown) {
  const parsed = z.object({ excludedNames: z.array(z.string().trim().min(1).max(2000)).max(100) }).strict().safeParse(value)
  if (!parsed.success || new Set(parsed.data.excludedNames).size !== parsed.data.excludedNames.length) throw new Error('Enter each excluded person once, one name per line.')
  if (stored != null && (typeof stored !== 'object' || Array.isArray(stored))) throw new Error('The saved guardian answers need review.')
  const entries = (stored ?? {}) as Record<string, unknown>
  if (entries.fid_excluded_guardian != null && (!Array.isArray(entries.fid_excluded_guardian) || entries.fid_excluded_guardian.some(row => !row || typeof row !== 'object' || Array.isArray(row)))) throw new Error('The saved guardian answers need review.')
  const previous = (entries.fid_excluded_guardian ?? []) as Record<string, unknown>[]
  return { excluded_guardian: parsed.data.excludedNames.join('; ') || null, fiduciary_entries: { ...entries,
    fid_excluded_guardian: parsed.data.excludedNames.map(name => previous.find(row => [row.first_name,row.middle_name,row.last_name,row.suffix].filter(Boolean).join(' ') === name) ?? (() => {
      const parts = splitName(name); return { first_name: parts.first, middle_name: parts.middle ?? '', last_name: parts.last, priority: 1, is_coagent: false }
    })()),
  } }
}
export function isStaffAppointmentBlock(key: string): key is keyof typeof STAFF_APPOINTMENT_BLOCKS {
  return Object.prototype.hasOwnProperty.call(STAFF_APPOINTMENT_BLOCKS, key)
}
export const appointmentSnapshotSchema = z.object({
  id: z.string().uuid(), contact_id: z.string().uuid(), role: z.string(), for_party: z.string(),
  priority: z.number().int(), is_coagent: z.boolean(),
}).strict()
const editSchema = z.object({
  matterId: z.string().uuid().nullable(), role: z.string(), party: z.enum(['client', 'spouse']),
  priority: z.number().int().min(1).max(10), coagent: z.boolean(), contactId: z.string().uuid().nullable(),
  expected: z.array(appointmentSnapshotSchema).max(1),
}).strict()
export type StaffAppointment = z.infer<typeof appointmentSnapshotSchema>
export type StaffAppointmentData = { matterId: string | null; roles: StaffAppointment[]; contacts: { id: string; name: string }[] }
export function parseStaffAppointmentEdit(block: string, value: unknown) {
  const parsed = editSchema.safeParse(value)
  if (!parsed.success || !isStaffAppointmentBlock(block)
    || !STAFF_APPOINTMENT_BLOCKS[block].some(([role, party]) => role === parsed.data.role && party === parsed.data.party)) {
    throw new Error('Select an appointment in this questionnaire section.')
  }
  const edit = parsed.data
  if (edit.expected.some(row => row.role !== edit.role || row.for_party !== edit.party || row.priority !== edit.priority || row.is_coagent !== edit.coagent)) {
    throw new Error('The appointment snapshot does not match this slot.')
  }
  return edit
}
