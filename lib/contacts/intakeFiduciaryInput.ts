import { FIDUCIARY_INTAKE_SLOTS } from '@/lib/sharedFields/fiduciaries'

export class IntakeFiduciaryInputError extends Error {}

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const TEXT_FIELDS = ['first_name', 'last_name', 'middle_name', 'suffix', 'preferred_pronoun', 'pronouns', 'phone', 'email', 'address', 'street', 'city', 'state', 'zip', 'relationship']

/** This capability edits questionnaire appointments, never arbitrary CRM roles.
 * The picker supports five principals and one coagent per principal, except HCP. */
export function validateIntakeFiduciaryInput(body: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!FIDUCIARY_INTAKE_SLOTS.some((slot) => slot.contactRole === body.role && slot.forParty === body.forParty)) {
    throw new IntakeFiduciaryInputError('Unsupported intake role or party')
  }
  if (!Array.isArray(body.entries)) throw new IntakeFiduciaryInputError('Fiduciary entries must be an array')
  const slots = new Set<string>()
  for (const entry of body.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new IntakeFiduciaryInputError('Invalid fiduciary entry')
    if (TEXT_FIELDS.some((key) => entry[key] != null && typeof entry[key] !== 'string')) throw new IntakeFiduciaryInputError('Invalid fiduciary contact details')
    if (!String(entry.first_name ?? '').trim() && !String(entry.last_name ?? '').trim()) throw new IntakeFiduciaryInputError('A fiduciary name is required')
    if (!Number.isInteger(entry.priority) || entry.priority < 1 || entry.priority > 5) throw new IntakeFiduciaryInputError('Invalid fiduciary priority')
    if ('is_coagent' in entry && typeof entry.is_coagent !== 'boolean') throw new IntakeFiduciaryInputError('Invalid coagent flag')
    if (entry.is_coagent && body.role === 'hcp') throw new IntakeFiduciaryInputError('Health care proxies cannot have coagents')
    if ('contact_id' in entry && (typeof entry.contact_id !== 'string' || !UUID.test(entry.contact_id))) throw new IntakeFiduciaryInputError('Invalid fiduciary contact ID')
    const slot = `${entry.priority}:${entry.is_coagent === true}`
    if (slots.has(slot)) throw new IntakeFiduciaryInputError('Duplicate fiduciary slot')
    slots.add(slot)
  }
  for (const entry of body.entries) {
    if (entry.is_coagent && !slots.has(`${entry.priority}:false`)) throw new IntakeFiduciaryInputError('A coagent requires a matching principal')
  }
  return body.entries
}
