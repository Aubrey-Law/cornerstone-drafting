import type { MattersClient } from './client'

/**
 * The three operations, as plain functions taking a client.
 *
 * No MCP types appear here on purpose: every rule is then testable against a
 * fake client without loading the SDK, and `tools.ts` stays a thin adapter.
 *
 * The column lists are string constants in this file so `scripts/checkDbColumns.mjs`
 * can see them — the same reason `apps/workbench/lib/prompts/designSheet.ts`
 * does it.
 */

const MATTER_SUMMARY_SELECT = 'id, name, matter_number, stage, relationship_status'
const MATTER_DETAIL_SELECT = 'id, name, matter_number, stage, relationship_status, status, matter_type'
const SHEET_SELECT = 'version, client_name, spouse_name'
const CONTACT_SELECT =
  'relationship_type, relationship_label, contacts ( first_name, middle_name, last_name, preferred_name )'

export interface MatterSummary {
  id: string
  name: string
  matterNumber: string | null
  stage: string | null
  relationshipStatus: string
}

export interface MatterDetail {
  matter: MatterSummary & { status: string; matterType: string | null }
  sheet: { version: number; clientName: string | null; spouseName: string | null } | null
  contacts: Array<{
    relationshipType: string
    relationshipLabel: string | null
    name: string
    preferredName: string | null
  }>
}

export interface ListMattersFilter {
  relationshipStatus?: string
  stage?: string
  nameContains?: string
}

/** Enough rows to survey the practice, few enough not to dump every client name. */
const LIST_LIMIT = 100

export async function listMatters(
  client: MattersClient,
  filter: ListMattersFilter,
): Promise<{ matters: MatterSummary[] }> {
  let query = client.from('matters').select(MATTER_SUMMARY_SELECT)
  if (filter.relationshipStatus) query = query.eq('relationship_status', filter.relationshipStatus)
  if (filter.stage) query = query.eq('stage', filter.stage)
  if (filter.nameContains) query = query.ilike('name', `%${filter.nameContains}%`)

  const { data, error } = await query.order('name').limit(LIST_LIMIT)
  // Throw rather than return an empty list. "No matters match" and "the query
  // failed" look identical to a caller that only sees rows, and the caller
  // would act on the wrong one.
  if (error) throw new Error(`Could not list matters: ${error.message}`)

  return { matters: (data ?? []).map(summaryOf) }
}

export async function getMatter(client: MattersClient, matterId: string): Promise<MatterDetail> {
  const { data: matter, error: matterError } = await client
    .from('matters')
    .select(MATTER_DETAIL_SELECT)
    .eq('id', matterId)
    .maybeSingle()
  if (matterError) throw new Error(`Could not read matter ${matterId}: ${matterError.message}`)
  if (!matter) throw new Error(`No matter ${matterId}`)

  const { data: sheets, error: sheetError } = await client
    .from('design_sheets')
    .select(SHEET_SELECT)
    .eq('matter_id', matterId)
  if (sheetError) throw new Error(`Could not read design sheets for ${matterId}: ${sheetError.message}`)

  const { data: contacts, error: contactError } = await client
    .from('matter_contacts')
    .select(CONTACT_SELECT)
    .eq('matter_id', matterId)
  if (contactError) throw new Error(`Could not read contacts for ${matterId}: ${contactError.message}`)

  // The highest version, not the first row: PostgREST returns no order unless
  // one is asked for, and the latest sheet is the one being drafted from.
  //
  // The accumulator is typed through an explicit alias rather than
  // `(typeof sheets)[number]`, which does not compile — `sheets` may be null,
  // and you cannot index a nullable type.
  type SheetRow = { version: number; client_name: string | null; spouse_name: string | null }
  const latest = ((sheets ?? []) as SheetRow[]).reduce<SheetRow | null>(
    (best, row) => (best === null || row.version > best.version ? row : best),
    null,
  )

  return {
    matter: { ...summaryOf(matter), status: matter.status, matterType: matter.matter_type },
    sheet: latest
      ? { version: latest.version, clientName: latest.client_name, spouseName: latest.spouse_name }
      : null,
    // `relationship_type` is reported verbatim, including the handful of rows
    // that say `client` where the rest say `self`. Normalising it here would
    // hide a real inconsistency behind a tool whose purpose is finding them.
    contacts: (contacts ?? []).map((row) => ({
      relationshipType: row.relationship_type,
      relationshipLabel: row.relationship_label,
      name: assembleName(row.contacts),
      preferredName: row.contacts?.preferred_name ?? null,
    })),
  }
}

function summaryOf(row: {
  id: string
  name: string
  matter_number: string | null
  stage: string | null
  relationship_status: string
}): MatterSummary {
  return {
    id: row.id,
    name: row.name,
    matterNumber: row.matter_number,
    stage: row.stage,
    relationshipStatus: row.relationship_status,
  }
}

/**
 * There is no `full_name` column; the name is assembled from three parts, any
 * of which may be null. Joining with a space and collapsing runs is what keeps
 * a missing middle name from leaving a double space.
 */
function assembleName(contact: {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
} | null): string {
  return [contact?.first_name, contact?.middle_name, contact?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
}
