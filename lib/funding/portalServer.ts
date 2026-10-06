import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'
import { loadFundingRows } from './repository'
import { toFundingAssets } from './rollup'
import { defaultMethodFor, isFunded, type FundingMethod, type FundingStatus } from './model'
import { clientMayReport, sortPortalAssets, toPortalAssets, type ClientAssetInput, type PortalAsset } from './portal'

/**
 * The funding tracker from the portal: reads for the client's own matter, the
 * asset they add, and the step they report done. Every caller has already
 * established that `matterId` is the signed-in client's (getMatterForUser);
 * reads and writes then run through the admin client, as the rest of the
 * portal does.
 */

type Admin = SupabaseClient<GeneratedDatabase>

// The admin client is typed against the app's Database alias; the funding
// repository against the generated one. Same schema, two names for it.
const admin = (): Admin => getAdminClient() as unknown as Admin

export async function fetchPortalAssets(matterId: string, client: Admin = admin()): Promise<PortalAsset[]> {
  const rows = await loadFundingRows(client, { matterId })
  return sortPortalAssets(toPortalAssets(toFundingAssets(rows)))
}

async function intakeIdForMatter(matterId: string, client: Admin): Promise<string> {
  const { data, error } = await client.from('matters').select('client_intake_id').eq('id', matterId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.client_intake_id) throw new Error('Matter not found')
  return data.client_intake_id as string
}

/**
 * An asset the client tells us about. Filed on the intake the matter hangs
 * off, marked as client-entered, and copied to the design sheet the way a
 * staff-entered asset is, so the drafting side sees it too.
 */
export async function createClientAsset(
  input: { matterId: string; asset: ClientAssetInput },
  client: Admin = admin(),
): Promise<{ assetId: string }> {
  const clientIntakeId = await intakeIdForMatter(input.matterId, client)
  const details = Object.fromEntries(
    Object.entries(input.asset.details).filter(([, value]) => value !== undefined),
  ) as Record<string, string>
  const { data, error } = await client
    .from('asset_intake')
    .insert({
      client_intake_id: clientIntakeId,
      category: input.asset.category,
      description: input.asset.description,
      value: input.asset.value,
      ownership: input.asset.ownership,
      details,
      source: 'client',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  try {
    const { syncAssetIntakeToDesignSheet } = await import('@/lib/assets/syncAssetIntakeToDesignSheet')
    await syncAssetIntakeToDesignSheet(client, input.matterId, clientIntakeId)
  } catch (caught) {
    // A matter without a design sheet yet, or a sync hiccup: the asset is
    // filed either way, and the next staff save syncs again.
    console.error('[portal assets] design sheet sync skipped', { matterId: input.matterId, cause: caught instanceof Error ? caught.message : String(caught) })
  }
  return { assetId: String(data.id) }
}

export type ClientReportResult =
  | { ok: true; status: FundingStatus; method: FundingMethod }
  | { ok: false; status: 404 | 409; message: string }

/**
 * The client says a step is done, with or without the institution's
 * confirmation attached.
 *
 * Never "confirmed": the model is clear that paperwork sent is the state
 * everyone mistakes for funded. The asset moves to awaiting_confirmation with
 * the document linked and the time recorded, and the firm is asked, through
 * the dial, to check it. An asset already confirmed is left alone.
 */
export async function recordClientRetitling(
  input: { matterId: string; assetId: string; documentId: string | null; note: string | null; actorId: string },
  client: Admin = admin(),
): Promise<ClientReportResult> {
  const clientIntakeId = await intakeIdForMatter(input.matterId, client)
  const { data: asset, error: assetError } = await client
    .from('asset_intake')
    .select('id, category, description')
    .eq('id', input.assetId)
    .eq('client_intake_id', clientIntakeId)
    .maybeSingle()
  if (assetError) throw new Error(assetError.message)
  if (!asset) return { ok: false, status: 404, message: 'That asset is not on your matter' }

  const { data: existing, error: existingError } = await client
    .from('asset_funding')
    .select('method, status')
    .eq('matter_id', input.matterId)
    .eq('asset_intake_id', input.assetId)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message)

  const method = (existing?.method as FundingMethod | undefined) ?? defaultMethodFor(asset.category as string)
  const status = (existing?.status as FundingStatus | undefined) ?? 'not_started'
  if (isFunded(status)) {
    return { ok: false, status: 409, message: 'This one is already recorded as done' }
  }
  if (!clientMayReport({ method, status })) {
    return { ok: false, status: 409, message: 'This step is ours to do; there is nothing for you to send for it' }
  }

  const now = new Date().toISOString()
  const { error } = await client
    .from('asset_funding')
    .upsert({
      matter_id: input.matterId,
      asset_intake_id: input.assetId,
      method,
      status: 'awaiting_confirmation',
      confirmed_on: null,
      ...(input.documentId ? { confirmation_document_id: input.documentId } : {}),
      client_reported_at: now,
      client_note: input.note,
      updated_by: input.actorId,
      updated_at: now,
    }, { onConflict: 'matter_id,asset_intake_id' })
  if (error) throw new Error(error.message)

  try {
    const { delegateFundingConfirmationReview } = await import('./delegateReview')
    await delegateFundingConfirmationReview({
      matterId: input.matterId,
      assetId: input.assetId,
      assetLabel: (asset.description as string) || (asset.category as string),
      documentId: input.documentId,
      note: input.note,
    })
  } catch (caught) {
    console.error('[portal assets] review task not offered', { matterId: input.matterId, cause: caught instanceof Error ? caught.message : String(caught) })
  }

  return { ok: true, status: 'awaiting_confirmation', method }
}
