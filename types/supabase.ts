/**
 * Compatibility adapter while existing queries are migrated to the checked-in
 * generated schema in `@aubrey-law/db-types`.
 *
 * New or materially changed database code should use `GeneratedDatabase`
 * directly. Removing this adapter is tracked by `check:db-types`; its presence
 * is intentional until the generated-type backlog is resolved table by table.
 */
export type { Database as GeneratedDatabase, Json } from '@aubrey-law/db-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CompatibilityRow = { [column: string]: any }

type CompatibilityTable = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Row: any
  Insert: CompatibilityRow
  Update: CompatibilityRow
  Relationships: []
}

type CompatibilityView = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Row: any
  Relationships: []
}

type CompatibilityFunction = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Args: Record<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Returns: any
}

export type Database = {
  public: {
    Tables: Record<string, CompatibilityTable>
    Views: Record<string, CompatibilityView>
    Functions: Record<string, CompatibilityFunction>
    Enums: Record<string, never>
    CompositeTypes: Record<string, Record<string, never>>
  }
}
