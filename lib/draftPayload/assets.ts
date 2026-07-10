import type { AssetItem } from '@/types/database'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

export interface DraftPayloadAsset {
  category: AssetItem['category']
  description: string
  institution: string | null
  estimated_value: number | null
  notes: string | null
  from_intake: boolean
}

export function draftPayloadAssets(
  designSheet: Pick<DesignSheetRow, 'assets'> | null | undefined,
): DraftPayloadAsset[] {
  const assets = Array.isArray(designSheet?.assets) ? designSheet.assets : []

  return assets
    .map(asset => ({
      category: asset.category,
      description: asset.description?.trim() || '',
      institution: asset.institution?.trim() || null,
      estimated_value: typeof asset.estimated_value === 'number' && Number.isFinite(asset.estimated_value)
        ? asset.estimated_value
        : null,
      notes: asset.notes?.trim() || null,
      from_intake: asset.from_intake === true,
    }))
    .filter(asset => asset.description.length > 0)
}

export function draftPayloadHasRealProperty(assets: DraftPayloadAsset[]): boolean {
  return assets.some(asset => asset.category === 'real_property')
}
