export type AssetCategory = string
export type Ownership = string

export interface AssetIntakeRow {
  id: string
  client_intake_id: string
  category: AssetCategory | string
  description: string
  value: number
  ownership: Ownership
  details: Record<string, string | number | string[] | null | undefined>
  created_at: string
  updated_at: string
}

export type AssetIntakeInput = Pick<AssetIntakeRow, 'category' | 'description' | 'value' | 'ownership' | 'details'>
