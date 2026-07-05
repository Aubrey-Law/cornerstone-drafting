# Portal migration archive

These 167 SQL migrations powered the full Aubrey Law CRM portal (leads, email, calendar, VA tasks, stage engine, etc.).

They were archived when Cornerstone Drafting moved to a **drafting-only migration baseline** in `supabase/migrations/`.

## When to use this archive

- **Existing production/staging databases** that already applied these migrations: leave them as-is. Do not reset and replay only the drafting baseline — you would lose CRM history and risk schema drift.
- **Debugging schema history**: trace when a column or policy was introduced.
- **Porting a fix**: if a drafting-relevant change only exists here, cherry-pick it into a new drafting migration.

## Greenfield drafting databases

Use only the files in `supabase/migrations/` (starting with `20260705000000_drafting_baseline_*.sql`).

If you need full column parity with production `design_sheets` / `client_intake`, run `supabase db pull` once against the shared firm project and diff against the baseline.
