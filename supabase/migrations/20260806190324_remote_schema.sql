-- Reduced to the only objects it actually owns. See the note below before
-- restoring anything from commit 49cd808.
--
-- This began as a `supabase db pull` snapshot. It was generated and stamped
-- into `supabase_migrations.schema_migrations`, but its SQL never ran anywhere
-- — and could not run where it sits:
--
--   • `supabase db reset` died here with `cannot drop view v_matter_pipeline
--     because other objects depend on it (2BP01)` — policies
--     `client_read_visible_matter_documents` and `client_insert_own_documents`
--     on `matter_documents`, created two migrations earlier by 20260806131355,
--     reference that view.
--   • Dropping those eight `drop view` lines only moved the failure on to
--     `column s.contact_id does not exist`: its `v_communication_threads`
--     selected `sms_messages.contact_id`, added later by 20260828000000, and
--     read `public.calls`, reshaped later still by 20260902000001.
--
-- The cause is a version-number collision, not bad SQL. Versions here are
-- future-dated by hand — 20260821000000 was committed 2026-07-31,
-- 20260902000001 on 2026-08-06 — while `db pull` stamps a *real* timestamp. A
-- pull run on 2026-08-06 therefore landed at 20260806190324, sorting ahead of a
-- dozen migrations already applied to production whose schema it had just
-- captured. It described a future it was ordered before.
--
-- What is kept below is everything no other migration creates: the
-- `box_private` schema, `box_document_exports` and `box_matter_folders` with
-- their indexes, constraints, RLS and grants, and
-- `box_private.enqueue_box_document_export()`. 20260806135231 retired the
-- trigger that called it but deliberately kept the queue, so the queue has to
-- exist. The `pg_net` drop stays because production has no such extension while
-- a local stack does.
--
-- What was removed was redundant, verified 2026-08-11 by replaying the chain
-- and diffing against production (qifunlovuwaryzsyfbnh):
--
--   • Eight `create or replace view` blocks — every one byte-identical to what
--     earlier and later migrations already build.
--   • `public.calls_autoassign` — byte-identical to the migration version.
--   • `public.create_billing_item` and `public.sms_messages_autoassign` —
--     identical once comments and whitespace are normalised (the pull stripped
--     the comments), and both redefined later by 20260819000000 and
--     20260828000000, which win on replay regardless.
--   • 875 grants to anon/authenticated/service_role on tables owned by other
--     migrations. These could not stay for the same ordering reason as the
--     views: putting them back fails the replay outright with
--     `relation "public.communication_thread_state" does not exist`, because
--     the tables they name are created later in the chain.
--
-- The grants those 875 lines carried are not lost: `supabase/seed.sql` now
-- reproduces production's anon/authenticated model for the local stack, where
-- grants belong here anyway — they come from Supabase's platform setup on the
-- hosted side, not from migrations. A fresh replay now matches production on
-- every measurable dimension: views, functions, table column sets, indexes,
-- policies, RLS flags, triggers, extensions, schemas and table ACLs.
--
-- Do not delete this file. `db push` refuses to run when a version recorded
-- remotely has no file behind it, and `scripts/checkMigrationDrift.mjs` reports
-- it as orphaned.

drop extension if exists "pg_net";

create schema if not exists "box_private";

  create table "public"."box_document_exports" (
    "id" uuid not null default gen_random_uuid(),
    "document_id" uuid not null,
    "matter_id" text not null,
    "status" text not null default 'pending'::text,
    "attempts" integer not null default 0,
    "next_attempt_at" timestamp with time zone not null default now(),
    "processing_started_at" timestamp with time zone,
    "box_folder_id" text,
    "box_file_id" text,
    "box_file_name" text,
    "last_error" text,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."box_document_exports" enable row level security;


  create table "public"."box_matter_folders" (
    "matter_id" text not null,
    "box_folder_id" text not null,
    "folder_name" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."box_matter_folders" enable row level security;

CREATE UNIQUE INDEX box_document_exports_box_file_id_key ON public.box_document_exports USING btree (box_file_id);

CREATE UNIQUE INDEX box_document_exports_document_id_key ON public.box_document_exports USING btree (document_id);

CREATE INDEX box_document_exports_due_idx ON public.box_document_exports USING btree (next_attempt_at, created_at) WHERE (status = 'pending'::text);

CREATE INDEX box_document_exports_matter_idx ON public.box_document_exports USING btree (matter_id, created_at DESC);

CREATE UNIQUE INDEX box_document_exports_pkey ON public.box_document_exports USING btree (id);

CREATE UNIQUE INDEX box_matter_folders_box_folder_id_key ON public.box_matter_folders USING btree (box_folder_id);

CREATE UNIQUE INDEX box_matter_folders_pkey ON public.box_matter_folders USING btree (matter_id);

alter table "public"."box_document_exports" add constraint "box_document_exports_pkey" PRIMARY KEY using index "box_document_exports_pkey";

alter table "public"."box_matter_folders" add constraint "box_matter_folders_pkey" PRIMARY KEY using index "box_matter_folders_pkey";

alter table "public"."box_document_exports" add constraint "box_document_exports_attempts_check" CHECK ((attempts >= 0)) not valid;

alter table "public"."box_document_exports" validate constraint "box_document_exports_attempts_check";

alter table "public"."box_document_exports" add constraint "box_document_exports_box_file_id_key" UNIQUE using index "box_document_exports_box_file_id_key";

alter table "public"."box_document_exports" add constraint "box_document_exports_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.matter_documents(id) ON DELETE CASCADE not valid;

alter table "public"."box_document_exports" validate constraint "box_document_exports_document_id_fkey";

alter table "public"."box_document_exports" add constraint "box_document_exports_document_id_key" UNIQUE using index "box_document_exports_document_id_key";

alter table "public"."box_document_exports" add constraint "box_document_exports_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text]))) not valid;

alter table "public"."box_document_exports" validate constraint "box_document_exports_status_check";

alter table "public"."box_matter_folders" add constraint "box_matter_folders_box_folder_id_key" UNIQUE using index "box_matter_folders_box_folder_id_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION box_private.enqueue_box_document_export()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.folder IN ('final', 'signed')
     AND (TG_OP = 'INSERT' OR OLD.folder IS DISTINCT FROM NEW.folder) THEN
    INSERT INTO public.box_document_exports (document_id, matter_id)
    VALUES (NEW.id, NEW.matter_id)
    ON CONFLICT (document_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."box_document_exports" to "service_role";
grant insert on table "public"."box_document_exports" to "service_role";
grant references on table "public"."box_document_exports" to "service_role";
grant select on table "public"."box_document_exports" to "service_role";
grant trigger on table "public"."box_document_exports" to "service_role";
grant truncate on table "public"."box_document_exports" to "service_role";
grant update on table "public"."box_document_exports" to "service_role";
grant delete on table "public"."box_matter_folders" to "service_role";
grant insert on table "public"."box_matter_folders" to "service_role";
grant references on table "public"."box_matter_folders" to "service_role";
grant select on table "public"."box_matter_folders" to "service_role";
grant trigger on table "public"."box_matter_folders" to "service_role";
grant truncate on table "public"."box_matter_folders" to "service_role";
grant update on table "public"."box_matter_folders" to "service_role";
