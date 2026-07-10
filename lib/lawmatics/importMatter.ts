import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import {
  fetchContactById,
  fetchProspectRelationships,
  matterToIntake,
} from '@/lib/lawmatics'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'

function splitName(full: string | null): { first: string; last: string | null } {
  const name = (full ?? '').trim()
  if (!name) return { first: '', last: null }
  const parts = name.split(/\s+/)
  return { first: parts[0]!, last: parts.slice(1).join(' ') || null }
}

async function upsertSpouseContact(
  admin: SupabaseClient,
  clientIntakeId: string,
  spouseName: string | null,
) {
  const spouse = splitName(spouseName)
  if (!spouse.first) return

  const row = {
    client_intake_id: clientIntakeId,
    first_name: spouse.first,
    last_name: spouse.last ?? '',
    relationship_type: 'spouse',
    relationship_label: 'Spouse',
    source: 'lawmatics',
  }

  const { data: existing, error: readError } = await admin
    .from('contacts')
    .select('id')
    .eq('client_intake_id', clientIntakeId)
    .eq('relationship_type', 'spouse')
    .maybeSingle()

  if (readError) throw new Error(readError.message)

  const result = existing
    ? await admin.from('contacts').update(row).eq('id', existing.id)
    : await admin.from('contacts').insert(row)

  if (result.error) throw new Error(result.error.message)
}

function buildIntakeRow(row: Record<string, unknown>, lmId: string) {
  const practiceArea = normalizePracticeArea(row.legal_plan)
  return {
    lawmatics_matter_id: lmId,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    date_of_birth: row.date_of_birth ?? null,
    address_line1: row.address_line1 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    marital_status: row.marital_status ?? null,
    other_individuals: row.other_individuals ?? null,
    special_notes: row.special_notes ?? null,
    practice_area: practiceArea,
    status: 'in_progress',
    updated_at: row.updated_at ?? new Date().toISOString(),
  }
}

export async function importMatterFromLawmaticsProspect(
  admin: SupabaseClient,
  accessToken: string,
  lmId: string,
  actorId: string | null,
): Promise<{ matterId: string; created: boolean }> {
  const res = await fetch(`https://api.lawmatics.com/v1/prospects/${encodeURIComponent(lmId)}?fields=all`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Lawmatics fetch failed (${res.status})`)
  }

  const json = await res.json()
  const contactId = (json.data?.attributes as Record<string, unknown> | undefined)?.contact_id

  const [relationships, clientContact] = await Promise.all([
    fetchProspectRelationships(accessToken, lmId),
    contactId ? fetchContactById(accessToken, contactId as string) : Promise.resolve(null),
  ])

  const mapped = matterToIntake(json.data, relationships, clientContact)
  const {
    spouse_name,
    legal_plan,
    campaign,
    matter_fee,
    case_number,
    ...intakeFields
  } = mapped
  const intakeRow = buildIntakeRow(intakeFields, lmId)

  const { data: intake, error: intakeError } = await admin
    .from('client_intake')
    .upsert(intakeRow, { onConflict: 'lawmatics_matter_id', ignoreDuplicates: false })
    .select('id, email, full_name')
    .single()

  if (intakeError || !intake) {
    throw new Error(intakeError?.message ?? 'Could not upsert intake')
  }

  await upsertSpouseContact(admin, intake.id, (spouse_name as string | null) ?? null)

  const fullName = (intake.full_name as string | null) ?? 'Unknown'
  const nameParts = splitName(fullName)
  await admin
    .from('client_intake')
    .update({ first_name: nameParts.first, last_name: nameParts.last })
    .eq('id', intake.id)

  const { data: existingMatter } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', intake.id)
    .maybeSingle()

  if (existingMatter) {
    return { matterId: existingMatter.id, created: false }
  }

  const practiceArea = normalizePracticeArea(legal_plan ?? intakeRow.practice_area)
  const practiceAreaName = practiceAreaLabel(practiceArea)
  const email = (intake.email as string | null)?.trim().toLowerCase() ?? null

  const { data: clientUser } = email
    ? await admin.from('users').select('id').eq('email', email).maybeSingle()
    : { data: null }

  const matterNumber = await generateUniqueMatterNumber(admin, {
    year: new Date().getFullYear(),
    practiceArea,
    clientLastName: nameParts.last,
    clientFirstName: nameParts.first,
  })
  const now = new Date().toISOString()

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .insert({
      client_intake_id: intake.id,
      client_id: clientUser?.id ?? null,
      name: `${fullName} — ${practiceAreaName}`,
      matter_number: matterNumber,
      stage: 'intake',
      status: 'active',
      stage_entered_at: now,
      track: 'DEFAULT',
    })
    .select('id')
    .single()

  if (matterError || !matter) {
    throw new Error(matterError?.message ?? 'Could not create matter')
  }

  await admin
    .from('client_intake')
    .update({ matter_id: matter.id })
    .eq('id', intake.id)

  const matterFee = typeof matter_fee === 'number' && Number.isFinite(matter_fee) ? matter_fee : null

  const { error: detailsError } = await admin.from('matter_details').upsert(
    {
      client_id: matter.id,
      practice_area: practiceArea,
      plan_type: 'TBD',
      matter_status: 'Active',
      client_status: 'active',
      jurisdiction_state: 'MA',
      matter_number: matterNumber,
      lawmatics_id: lmId,
      legal_plan: typeof legal_plan === 'string' ? legal_plan : null,
      referral_source: typeof campaign === 'string' ? campaign : null,
      flat_fee_amount: matterFee,
      matter_status_notes: typeof case_number === 'string' ? `Lawmatics case #: ${case_number}` : null,
    },
    { onConflict: 'client_id' },
  )

  if (detailsError) {
    throw new Error(detailsError.message)
  }

  try {
    await ensureDesignSheetSeededFromIntake(matter.id)
  } catch (e) {
    console.warn('design sheet seed on Lawmatics import skipped:', e)
  }

  try {
    await admin.from('matter_activity').insert({
      matter_id: matter.id,
      event_type: 'matter_created',
      title: 'Imported from Lawmatics',
      detail: fullName,
      actor_id: actorId,
    })
  } catch (e) {
    console.warn('matter_activity on Lawmatics import skipped:', e)
  }

  return { matterId: matter.id, created: true }
}
