import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { FundingMethod, FundingStatus } from './model'
import { methodIsPermitted } from './model'
import type { FundingJoinRow } from './rollup'

// The portal columns (asset source, the client's confirmation) arrive with
// migration 20270114090000. Code deploys before the migration runs, so each
// read is tried with them and falls back to the older list when the database
// does not have them yet.
const ASSET_SELECT = 'id, category, description, ownership, value, client_intake_id, source'
const LEGACY_ASSET_SELECT = 'id, category, description, ownership, value, client_intake_id'
const FUNDING_SELECT = 'matter_id, asset_intake_id, method, status, confirmed_on, note, confirmation_document_id, client_reported_at, client_note'
const LEGACY_FUNDING_SELECT = 'matter_id, asset_intake_id, method, status, confirmed_on, note'

type Loose = Record<string, unknown>

function isMissingColumn(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? '')
}

async function selectWithFallback(
  run: (select: string) => PromiseLike<{ data: unknown; error: { code?: string | null; message?: string | null } | null }>,
  select: string,
  legacySelect: string,
  what: string,
): Promise<Loose[]> {
  const first = await run(select)
  if (!first.error) return (first.data as Loose[] | null) ?? []
  if (!isMissingColumn(first.error)) throw new Error(`Could not load ${what}: ${first.error.message}`)
  const second = await run(legacySelect)
  if (second.error) throw new Error(`Could not load ${what}: ${second.error.message}`)
  return (second.data as Loose[] | null) ?? []
}

/**
 * Every asset on every open matter, with whatever funding has been recorded.
 *
 * Two queries rather than a join, because `asset_intake` hangs off
 * `client_intake_id` while funding hangs off `matter_id`, and PostgREST cannot
 * express that shape in one request. The firm's whole book is small enough that
 * assembling it here costs nothing and is far easier to read than a view.
 */
export async function loadFundingRows(
  client: SupabaseClient<GeneratedDatabase>,
  options: { matterId?: string } = {},
): Promise<FundingJoinRow[]> {
  const sb = client

  let matterQuery = sb
    .from('matters')
    .select('id, name, stage, client_intake_id')
    .eq('relationship_status', 'hired')
  if (options.matterId) matterQuery = matterQuery.eq('id', options.matterId)

  const { data: matters, error: matterError } = await matterQuery
  if (matterError) throw new Error(`Could not load matters: ${matterError.message}`)
  if (!matters || matters.length === 0) return []

  const intakeIds = [...new Set(matters.map((m) => m.client_intake_id as string))]
  const matterIds = matters.map((m) => m.id as string)

  const [assets, funding] = await Promise.all([
    selectWithFallback(
      select => sb.from('asset_intake').select(select).in('client_intake_id', intakeIds),
      ASSET_SELECT, LEGACY_ASSET_SELECT, 'assets',
    ),
    selectWithFallback(
      select => sb.from('asset_funding').select(select).in('matter_id', matterIds),
      FUNDING_SELECT, LEGACY_FUNDING_SELECT, 'funding',
    ),
  ])

  const fundingByKey = new Map(
    funding.map((f) => [`${f.matter_id}:${f.asset_intake_id}`, f]),
  )

  const rows: FundingJoinRow[] = []
  for (const matter of matters) {
    for (const asset of assets) {
      if (asset.client_intake_id !== matter.client_intake_id) continue
      const recorded = fundingByKey.get(`${matter.id}:${asset.id}`)
      rows.push({
        matter_id: matter.id as string,
        matter_title: (matter.name as string | null) ?? null,
        matter_stage: (matter.stage as string | null) ?? null,
        asset_id: asset.id as string,
        category: asset.category as string,
        description: (asset.description as string | null) ?? null,
        ownership: (asset.ownership as string | null) ?? null,
        value: asset.value as number | string | null,
        method: (recorded?.method as string | null) ?? null,
        status: (recorded?.status as string | null) ?? null,
        confirmed_on: (recorded?.confirmed_on as string | null) ?? null,
        note: (recorded?.note as string | null) ?? null,
        source: (asset.source as string | null) ?? null,
        confirmation_document_id: (recorded?.confirmation_document_id as string | null) ?? null,
        client_reported_at: (recorded?.client_reported_at as string | null) ?? null,
        client_note: (recorded?.client_note as string | null) ?? null,
      })
    }
  }
  return rows
}

export interface SaveFundingInput {
  matterId: string
  assetId: string
  category: string
  method: FundingMethod
  status: FundingStatus
  confirmedOn: string | null
  note: string | null
  userId: string
}

/**
 * Records the funding state of one asset.
 *
 * The two rules the database also enforces are checked here first, so the
 * attorney gets a sentence rather than a constraint violation. They are
 * enforced in both places deliberately: this app is not the only thing that can
 * write to the table, and neither rule is one to discover from a stack trace.
 */
export async function saveAssetFunding(
  client: SupabaseClient<GeneratedDatabase>,
  input: SaveFundingInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!methodIsPermitted(input.category, input.method)) {
    return {
      ok: false,
      message:
        'A retirement account cannot be retitled or deeded into a revocable trust — that is a taxable distribution of the whole account. Use a beneficiary designation.',
    }
  }

  if (input.status === 'confirmed' && !input.confirmedOn) {
    return {
      ok: false,
      message: 'Confirmed needs the date the confirmation arrived. Sent is not funded.',
    }
  }

  const { error } = await client
    .from('asset_funding')
    .upsert(
      {
        matter_id: input.matterId,
        asset_intake_id: input.assetId,
        method: input.method,
        status: input.status,
        confirmed_on: input.status === 'confirmed' ? input.confirmedOn : null,
        note: input.note,
        updated_by: input.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'matter_id,asset_intake_id' },
    )

  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
