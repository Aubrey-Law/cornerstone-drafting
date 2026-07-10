import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssetIntakeInput } from '@/types/assetIntake'
import type { Database } from '@/types/supabase'

export function toAssetIntakeRows(clientIntakeId: string, assets: AssetIntakeInput[]) {
  return assets.map(asset => ({
    client_intake_id: clientIntakeId,
    category: asset.category,
    description: asset.description.trim(),
    value: Number(asset.value) || 0,
    ownership: asset.ownership ?? 'client',
    details: asset.details ?? {},
  }))
}

export async function insertAssetIntakeRows(
  sb: SupabaseClient<Database>,
  clientIntakeId: string,
  assets: AssetIntakeInput[],
) {
  const rows = toAssetIntakeRows(clientIntakeId, assets)
  if (rows.length === 0) return { inserted: 0, assets: [] as unknown[] }

  const { data, error } = await sb.from('asset_intake').insert(rows).select()
  if (error) throw new Error(error.message)
  return { inserted: data?.length ?? 0, assets: data ?? [] }
}
