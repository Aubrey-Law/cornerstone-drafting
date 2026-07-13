/* eslint-disable @typescript-eslint/no-explicit-any -- permissive until generated types are checked in */
/**
 * Supabase `Database` generic for `@supabase/supabase-js` clients.
 *
 * Uses a permissive table map so query builders stay usable without checking
 * in full generated types. App-specific row shapes live in `types/database.ts`.
 */

type AnyRow = { [column: string]: any }

type AnyTable = {
  Row: any
  Insert: AnyRow
  Update: AnyRow
  Relationships: []
}

type AnyView = {
  Row: any
  Relationships: []
}

type AnyFunction = {
  Args: Record<string, any>
  Returns: any
}

export type Database = {
  public: {
    Tables: Record<string, AnyTable>
    Views: Record<string, AnyView>
    Functions: Record<string, AnyFunction>
    Enums: Record<string, never>
    CompositeTypes: Record<string, Record<string, any>>
  }
}
