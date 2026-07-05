-- Cornerstone Drafting — core schema (part 1 of 3)
-- Replaces 167 portal CRM migrations for greenfield drafting databases.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Staff / client profiles ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.users (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text,
  display_name text,
  role         text NOT NULL DEFAULT 'client'
    CHECK (role IN ('client', 'attorney', 'admin', 'va', 'staff')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own"
  ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ── Client intake ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_intake (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  matter_id           uuid,
  email               text,
  first_name          text,
  middle_name         text,
  last_name           text,
  full_name           text,
  preferred_pronoun   text,
  date_of_birth       date,
  phone               text,
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  zip                 text,
  county              text,
  marital_status      text,
  has_minor_children  boolean,
  plan_type           text,
  taxable_estate      numeric,
  practice_area       text,
  status              text NOT NULL DEFAULT 'draft',
  intake_sent_at      timestamptz,
  is_us_citizen       boolean DEFAULT true,
  fiduciary_entries   jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_intake_email ON public.client_intake(email);
CREATE INDEX IF NOT EXISTS idx_client_intake_client_user ON public.client_intake(client_user_id);
CREATE INDEX IF NOT EXISTS idx_client_intake_matter ON public.client_intake(matter_id);

ALTER TABLE public.client_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_intake_select_own"
  ON public.client_intake FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR client_user_id = auth.uid());

CREATE POLICY "client_intake_update_own"
  ON public.client_intake FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR client_user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() OR client_user_id = auth.uid());

CREATE POLICY "client_intake_insert_own"
  ON public.client_intake FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR client_user_id = auth.uid());

CREATE POLICY "attorneys_all_client_intake"
  ON public.client_intake FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

-- ── Matters ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.matters (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id         uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE RESTRICT,
  client_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name                     text NOT NULL DEFAULT '',
  matter_number            text,
  stage                    text NOT NULL DEFAULT 'drafting',
  status                   text NOT NULL DEFAULT 'active',
  flags                    text[] DEFAULT '{}',
  intake_submitted_at      timestamptz,
  drafts_sent_at           timestamptz,
  signing_date             timestamptz,
  documents_executed_at    timestamptz,
  li_plan_coverage         text,
  li_design_sheet_data     jsonb,
  li_design_sheet_approved boolean,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matters_client_intake ON public.matters(client_intake_id);
CREATE INDEX IF NOT EXISTS idx_matters_client_id ON public.matters(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matters_matter_number ON public.matters(matter_number) WHERE matter_number IS NOT NULL;

ALTER TABLE public.client_intake
  ADD CONSTRAINT client_intake_matter_id_fkey
  FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE SET NULL;

ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_read_own_matters"
  ON public.matters FOR SELECT TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "attorneys_all_matters"
  ON public.matters FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

-- ── Contacts ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_intake_id    uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  relationship_type   text NOT NULL,
  relationship_label  text,
  first_name          text,
  middle_name         text,
  last_name           text,
  suffix              text,
  preferred_name      text,
  preferred_pronoun   text,
  prior_names         text,
  date_of_birth       date,
  is_us_citizen       boolean,
  phone               text,
  email               text,
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  zip                 text,
  county              text,
  child_relationship  text,
  parentage           text,
  source              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_intake ON public.contacts(client_intake_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_one_spouse
  ON public.contacts(client_intake_id)
  WHERE relationship_type = 'spouse';

CREATE TABLE IF NOT EXISTS public.contact_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role        text NOT NULL,
  for_party   text NOT NULL DEFAULT 'client',
  priority    integer NOT NULL DEFAULT 1,
  is_coagent  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_roles_contact ON public.contact_roles(contact_id);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_manage_own_contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_intake ci
      WHERE ci.id = contacts.client_intake_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_intake ci
      WHERE ci.id = contacts.client_intake_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  );

CREATE POLICY "clients_manage_own_contact_roles"
  ON public.contact_roles FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contacts c
      JOIN public.client_intake ci ON ci.id = c.client_intake_id
      WHERE c.id = contact_roles.contact_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.contacts c
      JOIN public.client_intake ci ON ci.id = c.client_intake_id
      WHERE c.id = contact_roles.contact_id
        AND (ci.user_id = auth.uid() OR ci.client_user_id = auth.uid())
    )
  );

CREATE POLICY "attorneys_all_contacts"
  ON public.contacts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

CREATE POLICY "attorneys_all_contact_roles"
  ON public.contact_roles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

-- ── Design sheets ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.design_sheets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  client_intake_id uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  version         integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'draft',
  plan_type       text,
  is_joint        boolean,
  decisions       jsonb NOT NULL DEFAULT '{}'::jsonb,
  overrides       jsonb,
  goals_notes     text,
  concerns        text,
  assets          jsonb DEFAULT '[]'::jsonb,
  children        jsonb DEFAULT '[]'::jsonb,
  trustee_slots   jsonb DEFAULT '[]'::jsonb,
  executor_slots  jsonb DEFAULT '[]'::jsonb,
  poa_slots       jsonb DEFAULT '[]'::jsonb,
  hcp_slots       jsonb DEFAULT '[]'::jsonb,
  guardian_slots  jsonb DEFAULT '[]'::jsonb,
  temporary_guardian_slots jsonb DEFAULT '[]'::jsonb,
  spouse_trustee_slots jsonb DEFAULT '[]'::jsonb,
  spouse_executor_slots jsonb DEFAULT '[]'::jsonb,
  spouse_poa_slots jsonb DEFAULT '[]'::jsonb,
  spouse_hcp_slots jsonb DEFAULT '[]'::jsonb,
  specific_bequests jsonb DEFAULT '[]'::jsonb,
  disinheritances jsonb DEFAULT '[]'::jsonb,
  fiduciary_slot_states jsonb DEFAULT '{}'::jsonb,
  trust_name      text,
  spouse_trust_name text,
  restatement     boolean,
  trust_protector text,
  distribution_method text,
  distribution_age integer,
  residuary_beneficiary text,
  residual_beneficiary_individuals jsonb DEFAULT '[]'::jsonb,
  staggered_distributions jsonb DEFAULT '[]'::jsonb,
  remote_beneficiary text,
  remote_beneficiary_individuals jsonb DEFAULT '[]'::jsonb,
  remote_beneficiary_charities jsonb DEFAULT '[]'::jsonb,
  signing_date    date,
  signing_county  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_design_sheets_matter ON public.design_sheets(matter_id);

ALTER TABLE public.design_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clients_read_own_design_sheets"
  ON public.design_sheets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matters m
      WHERE m.id = design_sheets.matter_id AND m.client_id = auth.uid()
    )
  );

CREATE POLICY "attorneys_all_design_sheets"
  ON public.design_sheets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

-- ── Document template selections ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.doc_selections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_sheet_id  uuid NOT NULL REFERENCES public.design_sheets(id) ON DELETE CASCADE,
  doc_type         text,
  variant          text,
  party            text,
  selected         boolean NOT NULL DEFAULT true,
  sort_order       integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_selections_sheet ON public.doc_selections(design_sheet_id);

ALTER TABLE public.doc_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attorneys_all_doc_selections"
  ON public.doc_selections FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

-- ── Draft generation log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_log (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_sheet_id      uuid REFERENCES public.design_sheets(id) ON DELETE SET NULL,
  matter_id            uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  drafted_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sheet_version        integer,
  documents_generated  text[],
  missing_fields       jsonb,
  doc_type             text,
  model                text,
  status               text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draft_log_sheet ON public.draft_log(design_sheet_id);
CREATE INDEX IF NOT EXISTS idx_draft_log_matter ON public.draft_log(matter_id);

ALTER TABLE public.draft_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attorneys_read_draft_log"
  ON public.draft_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
