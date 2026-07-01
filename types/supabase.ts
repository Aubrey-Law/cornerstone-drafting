/* eslint-disable @typescript-eslint/no-explicit-any -- intentional permissive schema until `supabase gen types` is checked in */
/**
 * Permissive Supabase `Database` type used by the runtime clients.
 *
 * The project does not (yet) check generated types from `supabase gen types`
 * into source control. Without an explicit `Database` generic, recent versions
 * of `@supabase/supabase-js` resolve `Schema['Tables']` to `never`, which
 * makes every `.from('table').select(...)` query return `never` rows and
 * every `.insert/.update/.upsert/.rpc` payload type-check against `never`.
 *
 * Until generated types are wired in, treating every table/view as a
 * `Record<string, any>` row keeps the query builder usable while still
 * surfacing real type errors in the surrounding application code (call
 * sites can narrow with their own row interfaces from `types/database.ts`).
 *
 * If/when generated types are added, replace this file with the output of
 * `supabase gen types typescript --project-id <id> > types/supabase.ts`.
 */

// `Row` is intentionally `any` so query results widen freely into the
// hand-written row interfaces in `types/database.ts` (e.g. `PipelineMatter`,
// `MatterNote`, `Flag`). `Insert`/`Update` accept arbitrary object payloads.
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
