/*
  # Drop client_intake.is_unlocked — dead column

  Added in 20260613130000_intake_is_unlocked.sql as a flag for the admin
  "Unlock & edit intake" action. It was always written-but-never-read: the
  effective unlock was the accompanying status='draft' change, which reopened
  the intake for the CLIENT — the opposite of attorney-only editing.

  The attorney-direct-edit path was finished without this flag: saveAdminIntakeDraft
  (app/actions/adminIntake.ts) preserves the locked status (submitted/approved)
  and edits in place via the service-role client. The unlockIntakeForEdit action
  (the column's only writer) was removed; see the matter-page intake-edit change.

  Dependency scan: no readers anywhere (grep), no views/RPCs reference the column,
  and the only writer is gone. Safe, single-column drop.

  ORDERING: apply this only AFTER the code that removed unlockIntakeForEdit is
  deployed. While the old writer is still live in prod, dropping the column would
  make that action error.

  Guarded with IF EXISTS so it is idempotent against this repo's diverged
  migration history. Apply via `apply_migration` (records cleanly) — do NOT blind
  `db push`.
*/

ALTER TABLE public.client_intake
  DROP COLUMN IF EXISTS is_unlocked;
