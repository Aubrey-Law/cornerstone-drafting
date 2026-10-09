import type { SupabaseClient } from '@supabase/supabase-js'

/** A lead or matter another record can be merged into. */
export interface MergeTarget {
  id: string
  /** The lead page is keyed by intake, not by matter. */
  intakeId: string | null
  name: string
  email: string | null
  matterNumber: string | null
  relationshipStatus: string
  stage: string | null
  createdAt: string | null
}

const LIMIT = 10

type IntakeRow = {
  id: string
  matter_id: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email: string | null
}

type MatterRow = {
  id: string
  name: string | null
  matter_number: string | null
  relationship_status: string
  stage: string | null
  created_at: string | null
  client_intake_id: string | null
}

function intakeName(intake: IntakeRow | undefined): string | null {
  if (!intake) return null
  return intake.full_name?.trim()
    || [intake.first_name, intake.last_name].filter(Boolean).join(' ').trim()
    || null
}

/** Strip the characters PostgREST's `or()` filter treats as syntax. */
function safeTerm(term: string): string {
  return term.replace(/[%,()*]/g, ' ').trim()
}

/**
 * Leads and matters `matterId` could be merged into.
 *
 * With no query, proposes the records that share its client's email — the
 * returning client whose new intake opened a second lead is the case this
 * exists for. Archived and already-merged records are never offered: merging
 * into a tombstone would build a chain nothing resolves.
 */
export async function findMergeTargets(
  admin: SupabaseClient,
  matterId: string,
  query: string,
): Promise<MergeTarget[]> {
  const term = safeTerm(query)
  const candidateIds = new Set<string>()

  if (term) {
    const [{ data: intakes, error: intakeError }, { data: matters, error: matterError }] = await Promise.all([
      admin
        .from('client_intake')
        .select('matter_id')
        .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .not('matter_id', 'is', null)
        .limit(50),
      admin
        .from('matters')
        .select('id')
        .or(`name.ilike.%${term}%,matter_number.ilike.%${term}%`)
        .limit(50),
    ])
    if (intakeError) throw new Error(intakeError.message)
    if (matterError) throw new Error(matterError.message)
    for (const row of (intakes ?? []) as Array<{ matter_id: string }>) candidateIds.add(row.matter_id)
    for (const row of (matters ?? []) as Array<{ id: string }>) candidateIds.add(row.id)
  } else {
    const { data: self, error: selfError } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .maybeSingle()
    if (selfError) throw new Error(selfError.message)
    if (!self?.client_intake_id) return []

    const { data: selfIntake, error: selfIntakeError } = await admin
      .from('client_intake')
      .select('email')
      .eq('id', self.client_intake_id)
      .maybeSingle()
    if (selfIntakeError) throw new Error(selfIntakeError.message)
    const email = selfIntake?.email?.trim()
    if (!email) return []

    const { data: sameEmail, error: sameEmailError } = await admin
      .from('client_intake')
      .select('matter_id')
      // Escaped so an underscore in the address matches only itself.
      .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
      .not('matter_id', 'is', null)
      .limit(50)
    if (sameEmailError) throw new Error(sameEmailError.message)
    for (const row of (sameEmail ?? []) as Array<{ matter_id: string }>) candidateIds.add(row.matter_id)
  }

  candidateIds.delete(matterId)
  if (candidateIds.size === 0) return []

  const { data: matters, error } = await admin
    .from('matters')
    .select('id, name, matter_number, relationship_status, stage, created_at, client_intake_id')
    .in('id', [...candidateIds])
    .neq('status', 'archived')
    .is('merged_into_id', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  if (error) throw new Error(error.message)

  const rows = (matters ?? []) as MatterRow[]
  const intakeIds = rows.map(row => row.client_intake_id).filter((id): id is string => Boolean(id))
  const { data: intakes, error: intakesError } = intakeIds.length
    ? await admin
      .from('client_intake')
      .select('id, matter_id, first_name, last_name, full_name, email')
      .in('id', intakeIds)
    : { data: [] as IntakeRow[], error: null }
  if (intakesError) throw new Error(intakesError.message)
  const intakeById = new Map(((intakes ?? []) as IntakeRow[]).map(row => [row.id, row]))

  return rows.map(row => {
    const intake = row.client_intake_id ? intakeById.get(row.client_intake_id) : undefined
    return {
      id: row.id,
      intakeId: row.client_intake_id,
      name: intakeName(intake) || row.name?.trim() || row.matter_number || 'Unnamed record',
      email: intake?.email ?? null,
      matterNumber: row.matter_number,
      relationshipStatus: row.relationship_status,
      stage: row.stage,
      createdAt: row.created_at,
    }
  })
}

/** Where a record lives: hired work on the matter page, anything else on the lead page. */
export function mergeTargetHref(target: Pick<MergeTarget, 'id' | 'intakeId' | 'relationshipStatus'>): string {
  return target.relationshipStatus !== 'hired' && target.intakeId
    ? `/admin/leads/${target.intakeId}`
    : `/admin/matters/${target.id}`
}

/**
 * Where an old link to a merged-away lead or matter should go: the record it
 * was merged into, or null when it was not merged. Best-effort — a lookup
 * failure leaves the archived record viewable rather than breaking the page.
 */
export async function mergedRecordHref(admin: SupabaseClient, matterId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('matters')
    .select('merged_into_id')
    .eq('id', matterId)
    .maybeSingle()
  const winnerId = (data as { merged_into_id?: string | null } | null)?.merged_into_id
  if (error || !winnerId) return null

  const { data: winner } = await admin
    .from('matters')
    .select('id, client_intake_id, relationship_status')
    .eq('id', winnerId)
    .maybeSingle()
  if (!winner) return null
  return mergeTargetHref({
    id: winner.id as string,
    intakeId: (winner.client_intake_id as string | null) ?? null,
    relationshipStatus: winner.relationship_status as string,
  })
}
