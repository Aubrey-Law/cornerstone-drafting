import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssetItem } from '@/types/database'
import type { AssetCategory } from '@/lib/estateTax'
import { buildDesignSheetPersistencePayload } from '@/lib/designSheetPersistence'

type AssetIntakeRow = {
  id: string
  category: string
  description: string
  value: number
  ownership: string
  details: Record<string, unknown> | null
}

function mapCategoryToDesignSheet(category: AssetCategory | string): AssetItem['category'] {
  switch (category) {
    case 'real_estate':
      return 'real_property'
    case 'retirement':
      return 'retirement'
    case 'life_insurance':
      return 'life_insurance'
    case 'business':
      return 'business'
    case 'bank':
    case 'investment':
    case 'vehicles':
    case 'personal_property':
    case 'inheritance':
    case 'crypto':
      return 'financial'
    default:
      return 'other'
  }
}

function assetIntakeToDesignItem(row: AssetIntakeRow): AssetItem {
  const details = row.details ?? {}
  const institution =
    (typeof details.institution === 'string' && details.institution)
    || (typeof details.account_name === 'string' && details.account_name)
    || ''
  const notesParts = [
    row.ownership !== 'client' ? `Ownership: ${row.ownership}` : null,
    typeof details.notes === 'string' ? details.notes : null,
  ].filter(Boolean)

  return {
    id: row.id,
    category: mapCategoryToDesignSheet(row.category),
    description: row.description || 'Asset',
    institution,
    estimated_value: row.value > 0 ? row.value : null,
    notes: notesParts.join(' · '),
    from_intake: true,
  }
}

/**
 * Merge asset_intake rows into design_sheets.assets for a matter.
 * Preserves manually added design-sheet assets that are not linked to intake rows.
 */
export async function syncAssetIntakeToDesignSheet(
  admin: SupabaseClient,
  matterId: string,
  clientIntakeId: string,
): Promise<{ synced: number; assets: AssetItem[] }> {
  const [{ data: sheet, error: sheetErr }, { data: intakeRows, error: intakeErr }] = await Promise.all([
    admin.from('design_sheets').select('id, assets').eq('matter_id', matterId).maybeSingle(),
    admin.from('asset_intake').select('id, category, description, value, ownership, details').eq('client_intake_id', clientIntakeId),
  ])

  if (sheetErr) throw new Error(sheetErr.message)
  if (intakeErr) throw new Error(intakeErr.message)
  if (!sheet?.id) throw new Error('No design sheet found for this matter')

  const intakeItems = (intakeRows ?? []).map(row => assetIntakeToDesignItem(row as AssetIntakeRow))
  const existing = Array.isArray(sheet.assets) ? (sheet.assets as AssetItem[]) : []
  const preserved = existing.filter(item => !item.from_intake)
  const merged = [...preserved, ...intakeItems]
  const payload = buildDesignSheetPersistencePayload({ assets: merged })

  const { error: updateErr } = await admin
    .from('design_sheets')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', sheet.id)

  if (updateErr) throw new Error(updateErr.message)

  return { synced: intakeItems.length, assets: merged }
}

/** Resolve matter from intake id and sync; logs and swallows errors so asset saves still succeed. */
export async function syncAssetIntakeToDesignSheetForIntake(
  admin: SupabaseClient,
  clientIntakeId: string,
): Promise<{ synced: number } | null> {
  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', clientIntakeId)
    .maybeSingle()

  if (matterErr) {
    console.error('[asset sync] matter lookup failed:', matterErr.message)
    return null
  }
  if (!matter?.id) return null

  try {
    const result = await syncAssetIntakeToDesignSheet(admin, matter.id, clientIntakeId)
    return { synced: result.synced }
  } catch (error) {
    console.error('[asset sync] design sheet sync failed:', error)
    return null
  }
}
