/**
 * The schema this app actually reads, as a type.
 *
 * The root app carries ~10,600 lines of generated types for ~120 tables. The
 * Workbench reads one column of one table today, and typing its clients
 * against a schema this small does two things: queries are checked rather than
 * `any`, and postgrest's type machinery has something small to resolve — an
 * untyped client makes `from().select().eq()` instantiate deeply enough that
 * tsc gives up (TS2589).
 *
 * This is a stepping stone, not a second source of truth. The generated types
 * move into a shared package when the drafting port needs the full schema,
 * with the root app re-exporting them — the same shim pattern as
 * `@aubrey-law/ui`. Until then, adding a table here is a deliberate act that
 * says which data this app has started to touch.
 */
export type WorkbenchDatabase = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string | null
          role: string | null
        }
        Insert: {
          id: string
          email?: string | null
          role?: string | null
        }
        Update: {
          id?: string
          email?: string | null
          role?: string | null
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
