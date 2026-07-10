import type { SupabaseClient } from '@supabase/supabase-js'
import { mapImportedAssetCategory } from '@/lib/import/mapAssetCategory'
import type { Ownership } from '@/lib/estateTax'
import type { Database } from '@/types/supabase'

export function normalizeImportedOwnership(raw: unknown): Ownership {
  const v = String(raw ?? 'client').toLowerCase().trim()
  if (!v || v === 'primary' || v === 'client' || v.includes('client')) return 'client'
  if (v.includes('spouse')) return 'spouse'
  if (v.includes('joint')) return 'joint'
  return 'client'
}

export function toAssetIntakeInsertRows(
  clientIntakeId: string,
  assets: unknown[],
) {
  return assets.map(item => {
    const record = item as Record<string, unknown>
    const details = (record.details && typeof record.details === 'object'
      ? record.details
      : {}) as Record<string, string | number>

    return {
      client_intake_id: clientIntakeId,
      category: mapImportedAssetCategory(record.category),
      description: String(record.description ?? '').trim() || 'Imported asset',
      value: Number(record.value) || 0,
      ownership: normalizeImportedOwnership(record.ownership),
      details,
    }
  })
}

export async function insertImportedAssetRows(
  sb: SupabaseClient<Database>,
  clientIntakeId: string,
  assets: unknown[],
) {
  const rows = toAssetIntakeInsertRows(clientIntakeId, assets)
  if (rows.length === 0) return { inserted: 0, assets: [] as unknown[] }

  const { data, error } = await sb.from('asset_intake').insert(rows).select()
  if (error) throw new Error(error.message)
  return { inserted: data?.length ?? 0, assets: data ?? [] }
}
