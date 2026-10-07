import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  LedgerInputError,
  type AssetCategory,
  type AssetInput,
  type EntryInput,
  type EntryKind,
  type EstateAsset,
  type Fund,
  type LedgerEntry,
} from './model'

/**
 * Reads and writes for the fiduciary ledger. Every caller is a staff route
 * that has already passed `requireAdmin`; the service-role client is used and
 * every query is scoped to the matter in the URL.
 */

type Admin = ReturnType<typeof getAdminClient>

const ASSET_COLUMNS = 'id, matter_id, description, category, probate, date_of_death_value_cents, valuation_note'
const ENTRY_COLUMNS = 'id, matter_id, entry_date, kind, fund, amount_cents, description, counterparty, asset_id'

export class EstateLedgerUnavailableError extends Error {
  constructor() {
    super('The estate ledger is not available until the estate ledger migration has run')
  }
}

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /does not exist|could not find the table/i.test(error.message ?? '')
}

function assetFromRow(row: Record<string, unknown>): EstateAsset {
  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    description: String(row.description ?? ''),
    category: String(row.category ?? 'other') as AssetCategory,
    probate: row.probate !== false,
    dateOfDeathValueCents: Number(row.date_of_death_value_cents ?? 0),
    valuationNote: typeof row.valuation_note === 'string' ? row.valuation_note : null,
  }
}

function entryFromRow(row: Record<string, unknown>): LedgerEntry {
  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    entryDate: String(row.entry_date ?? '').slice(0, 10),
    kind: String(row.kind) as EntryKind,
    fund: (row.fund === 'income' ? 'income' : 'principal') as Fund,
    amountCents: Number(row.amount_cents ?? 0),
    description: String(row.description ?? ''),
    counterparty: typeof row.counterparty === 'string' ? row.counterparty : null,
    assetId: typeof row.asset_id === 'string' ? row.asset_id : null,
  }
}

/** The inventory and every entry, or null while the tables do not exist. */
export async function loadLedger(admin: Admin, matterId: string): Promise<{ assets: EstateAsset[]; entries: LedgerEntry[] } | null> {
  const [assets, entries] = await Promise.all([
    admin.from('estate_assets').select(ASSET_COLUMNS).eq('matter_id', matterId).order('created_at').limit(1000),
    admin.from('estate_ledger_entries').select(ENTRY_COLUMNS).eq('matter_id', matterId).order('entry_date').order('created_at').limit(5000),
  ])
  if (isMissingRelation(assets.error) || isMissingRelation(entries.error)) return null
  if (assets.error) throw new Error(assets.error.message)
  if (entries.error) throw new Error(entries.error.message)
  return {
    assets: ((assets.data ?? []) as Record<string, unknown>[]).map(assetFromRow),
    entries: ((entries.data ?? []) as Record<string, unknown>[]).map(entryFromRow),
  }
}

export async function createAsset(admin: Admin, matterId: string, input: AssetInput, actorId: string): Promise<EstateAsset> {
  const { data, error } = await admin.from('estate_assets').insert({
    matter_id: matterId,
    description: input.description,
    category: input.category,
    probate: input.probate,
    date_of_death_value_cents: input.dateOfDeathValueCents,
    valuation_note: input.valuationNote,
    created_by: actorId,
  }).select(ASSET_COLUMNS).single()
  if (error) {
    if (isMissingRelation(error)) throw new EstateLedgerUnavailableError()
    throw new Error(error.message)
  }
  return assetFromRow(data as Record<string, unknown>)
}

/**
 * Corrects an asset. Once it has been sold or distributed its value and probate
 * status are fixed, because a sale's gain and an in-kind distribution were
 * measured against them.
 */
export async function updateAsset(admin: Admin, matterId: string, assetId: string, input: AssetInput, disposed: boolean): Promise<EstateAsset | null> {
  const patch: Record<string, unknown> = {
    description: input.description,
    category: input.category,
    valuation_note: input.valuationNote,
    updated_at: new Date().toISOString(),
  }
  if (!disposed) {
    patch.probate = input.probate
    patch.date_of_death_value_cents = input.dateOfDeathValueCents
  }
  const { data, error } = await admin.from('estate_assets').update(patch).eq('id', assetId).eq('matter_id', matterId).select(ASSET_COLUMNS).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? assetFromRow(data as Record<string, unknown>) : null
}

/** An asset that has been sold or distributed cannot be removed; delete the entry first. */
export async function deleteAsset(admin: Admin, matterId: string, assetId: string): Promise<boolean> {
  const { data, error } = await admin.from('estate_assets').delete().eq('id', assetId).eq('matter_id', matterId).select('id')
  if (error) {
    if (error.code === '23503') throw new LedgerInputError('This asset has been sold or distributed. Delete that entry first.')
    throw new Error(error.message)
  }
  return (data?.length ?? 0) > 0
}

export async function createEntry(admin: Admin, matterId: string, input: EntryInput, actorId: string): Promise<LedgerEntry> {
  const { data, error } = await admin.from('estate_ledger_entries').insert({
    matter_id: matterId,
    entry_date: input.entryDate,
    kind: input.kind,
    fund: input.fund,
    amount_cents: input.amountCents,
    description: input.description,
    counterparty: input.counterparty,
    asset_id: input.assetId,
    created_by: actorId,
  }).select(ENTRY_COLUMNS).single()
  if (error) {
    if (isMissingRelation(error)) throw new EstateLedgerUnavailableError()
    // The unique index: two requests raced to dispose of the same asset.
    if (error.code === '23505') throw new LedgerInputError('That asset has already been sold or distributed')
    throw new Error(error.message)
  }
  return entryFromRow(data as Record<string, unknown>)
}

export async function deleteEntry(admin: Admin, matterId: string, entryId: string): Promise<boolean> {
  const { data, error } = await admin.from('estate_ledger_entries').delete().eq('id', entryId).eq('matter_id', matterId).select('id')
  if (error) throw new Error(error.message)
  return (data?.length ?? 0) > 0
}
