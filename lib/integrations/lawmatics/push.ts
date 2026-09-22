import 'server-only'
import { getIntegrationSettings } from '@/lib/integrations/settings'
import {
  beginIntegrationAttempt, claimExternalRecord, getExternalRecord,
  recordIntegrationFailure, recordIntegrationSuccess, type ExternalRecordRef,
} from '@/lib/integrations/records'
import { IntegrationError } from '@/lib/integrations/errors'
import { createLawmaticsProspectFromBody, updateLawmaticsProspect } from './client'
import { createAndRecordLawmatics, lawmaticsDatabase, lawmaticsFailure, requireSafeCreate, sourceHash } from './prospect'
import {
  buildLawmaticsProspectBody, LAWMATICS_PUSH_FIELDS,
  type LawmaticsPushSource, type LawmaticsProspectBody,
} from './pushFields'

export interface LawmaticsPushResult {
  prospectId: string
  operation: 'created' | 'updated'
  /** Labels of the fields that carried a value and were sent. */
  sent: string[]
  /** Labels of fields with a value that have no Lawmatics custom field mapped yet. */
  unmapped: string[]
}

const INTAKE_FIELDS = [
  'id', 'first_name', 'middle_name', 'last_name', 'suffix', 'preferred_name', 'email', 'phone',
  'date_of_birth', 'marital_status', 'address_line1', 'address_line2', 'city', 'county', 'state', 'zip',
  'lead_source', 'referral_source', 'practice_area', 'plan_type', 'lead_status', 'estate_value',
  'occupation', 'employer', 'citizenship', 'preferred_pronoun', 'date_of_marriage', 'marriage_date',
  'legal_plan_member_id', 'planning_objectives', 'special_notes', 'qualification_notes', 'notes',
  'lawmatics_matter_id',
].join(', ')

const HOUSEHOLD_FIELDS = 'id, relationship_type, first_name, last_name, email, phone, date_of_birth, created_at'

type HouseholdContact = {
  id: string
  relationship_type: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
}

async function householdContacts(intakeId: string, matterId: string | null): Promise<HouseholdContact[]> {
  const db = lawmaticsDatabase()
  if (!matterId) {
    const { data, error } = await db.from('contacts').select(HOUSEHOLD_FIELDS)
      .eq('client_intake_id', intakeId).in('relationship_type', ['spouse', 'child'])
      .order('created_at', { ascending: true }).order('id', { ascending: true })
    if (error) throw lawmaticsFailure('source_unavailable', 'The household contacts could not be read.', 'retryable')
    return (data ?? []) as HouseholdContact[]
  }
  // A hired matter's household is its matter_contacts membership, which carries the role.
  const { data: memberships, error } = await db.from('matter_contacts').select('contact_id, relationship_type')
    .eq('matter_id', matterId).in('relationship_type', ['spouse', 'child'])
  if (error) throw lawmaticsFailure('source_unavailable', 'The matter household could not be read.', 'retryable')
  if (!memberships?.length) return []
  const { data: contacts, error: contactsError } = await db.from('contacts').select(HOUSEHOLD_FIELDS)
    .in('id', memberships.map(row => row.contact_id))
    .order('created_at', { ascending: true }).order('id', { ascending: true })
  if (contactsError) throw lawmaticsFailure('source_unavailable', 'The household contacts could not be read.', 'retryable')
  const roles = new Map(memberships.map(row => [row.contact_id, row.relationship_type]))
  return ((contacts ?? []) as HouseholdContact[]).map(contact => ({ ...contact, relationship_type: roles.get(contact.id) ?? null }))
}

/** Reads everything a push sends, from service-role source reads. */
export async function loadLawmaticsPushSource(intakeId: string): Promise<LawmaticsPushSource & { legacyProspectId: string | null }> {
  const db = lawmaticsDatabase()
  const { data: intake, error } = await db.from('client_intake').select(INTAKE_FIELDS).eq('id', intakeId).maybeSingle()
  if (error) throw lawmaticsFailure('source_unavailable', 'The client record could not be read.', 'retryable')
  if (!intake) throw lawmaticsFailure('identity_required', 'The client record could not be found.')
  const row = intake as unknown as Record<string, string | null>

  const { data: matter, error: matterError } = await db.from('matters').select('id, matter_number')
    .eq('client_intake_id', intakeId).maybeSingle()
  if (matterError) throw lawmaticsFailure('source_unavailable', 'The linked matter could not be read.', 'retryable')

  const household = await householdContacts(intakeId, matter?.id ?? null)
  const spouse = household.find(contact => contact.relationship_type === 'spouse') ?? null
  const children = household.filter(contact => contact.relationship_type === 'child')

  return {
    intake: row,
    matterNumber: matter?.matter_number ?? null,
    spouse,
    children,
    legacyProspectId: row.lawmatics_matter_id?.trim() || null,
  }
}

function labels(keys: string[]): string[] {
  return keys.map(key => LAWMATICS_PUSH_FIELDS.find(field => field.key === key)?.label ?? key)
}

/**
 * Manually pushes a lead or client to Lawmatics: creates the prospect the first
 * time, and updates the linked prospect on every later push. The prospect link
 * is the same record appointment sync uses, so neither path ever duplicates the
 * other's prospect, and an ambiguous earlier create is surfaced, never retried.
 */
export async function pushLeadToLawmatics(intakeId: string): Promise<LawmaticsPushResult> {
  const settings = await getIntegrationSettings()
  const source = await loadLawmaticsPushSource(intakeId)
  const built = buildLawmaticsProspectBody(source, settings.lawmaticsCustomFieldIdMap)
  const body: LawmaticsProspectBody = built.body

  const ref: ExternalRecordRef = { provider: 'lawmatics', internalEntityType: 'lead', internalEntityId: intakeId, externalRecordType: 'prospect' }
  const existing = await getExternalRecord(ref)
  const linkedId = existing?.external_id ?? source.legacyProspectId

  if (!linkedId && (!body.first_name || !body.last_name)) {
    throw lawmaticsFailure('identity_required', 'Add a first and last name before pushing to Lawmatics.')
  }

  // An earlier create whose outcome is unknown (or still running) must be
  // resolved first: re-claiming the record would orphan a prospect it made.
  if (!existing?.external_id) await requireSafeCreate(existing, ref)

  const version = sourceHash({ intakeId, body })
  const claimed = await claimExternalRecord({
    ...ref, sourceVersion: version, idempotencyKey: `lawmatics:prospect-push:${intakeId}:${version}`,
    requestHash: version, requestSnapshot: { intakeId, operation: linkedId ? 'update' : 'create', fields: built.sentKeys },
  })
  const result = { sent: labels(built.sentKeys), unmapped: labels(built.unmappedKeys) }

  const prospectId = claimed.external_id ?? linkedId
  if (!prospectId) {
    const created = await createAndRecordLawmatics(ref, claimed, () => createLawmaticsProspectFromBody(body), existing)
    return { prospectId: created, operation: 'created', ...result }
  }

  const fenced = await beginIntegrationAttempt({ ...ref, idempotencyKey: claimed.idempotency_key,
    expectedLastAttemptAt: claimed.last_attempt_at })
  const attempt = { ...ref, idempotencyKey: claimed.idempotency_key, attemptAt: fenced.last_attempt_at! }
  try {
    await updateLawmaticsProspect(prospectId, body)
  } catch (error) {
    const safe = error instanceof IntegrationError
      ? error : lawmaticsFailure('request_rejected', 'Lawmatics rejected the update.')
    await recordIntegrationFailure({ ...attempt, error: safe })
    throw safe
  }
  await recordIntegrationSuccess({ ...attempt, externalId: prospectId })
  return { prospectId, operation: 'updated', ...result }
}
