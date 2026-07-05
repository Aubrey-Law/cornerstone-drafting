/*
  # Firm-wide contacts foundation

  Evolves `contacts` from a household-scoped helper table into the canonical
  firm contact record while preserving existing client_intake/lead/referral
  workflows. Relationship tables carry context-specific roles so a person can be
  a lead, client spouse, fiduciary, referral partner, notary, witness, or other
  firm contact without duplicating identity fields.
*/

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS crm_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS firm_notes text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT ARRAY[]::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_crm_status_check') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_crm_status_check
      CHECK (crm_status IN ('active', 'archived', 'do_not_contact'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.contacts.crm_status IS
  'Firm CRM lifecycle status for a reusable contact record.';
COMMENT ON COLUMN public.contacts.organization_name IS
  'Denormalized organization/practice name for quick list rendering; canonical org links live in contact_organization_memberships.';
COMMENT ON COLUMN public.contacts.job_title IS
  'Professional title for referral partners, notaries, witnesses, vendors, and other firm contacts.';
COMMENT ON COLUMN public.contacts.firm_notes IS
  'Internal firm notes about this contact, not visible to clients.';
COMMENT ON COLUMN public.contacts.tags IS
  'Lightweight firm-managed tags for contact segmentation.';

CREATE INDEX IF NOT EXISTS contacts_crm_status_idx ON public.contacts (crm_status);
CREATE INDEX IF NOT EXISTS contacts_relationship_type_idx ON public.contacts (relationship_type);
CREATE INDEX IF NOT EXISTS contacts_tags_gin_idx ON public.contacts USING gin (tags);

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.contacts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%relationship_type%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contacts DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_relationship_type_check
    CHECK (relationship_type IN (
      'spouse', 'child', 'parent', 'sibling', 'friend', 'professional',
      'fiduciary', 'referral_partner', 'notary', 'witness', 'vendor', 'other'
    ));
END;
$$;

CREATE TABLE IF NOT EXISTS public.contact_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  organization_type text NOT NULL DEFAULT 'other'
    CHECK (organization_type IN (
      'law_firm', 'financial_advisor', 'accounting_firm', 'bank',
      'notary_service', 'vendor', 'community_partner', 'other'
    )),
  email text,
  phone text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_organizations_name_idx
  ON public.contact_organizations (lower(name));
CREATE INDEX IF NOT EXISTS contact_organizations_type_idx
  ON public.contact_organizations (organization_type);

CREATE TABLE IF NOT EXISTS public.contact_organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.contact_organizations(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'member'
    CHECK (relationship_type IN (
      'employee', 'owner', 'partner', 'referral_contact', 'vendor_contact',
      'notary', 'witness_pool', 'member', 'other'
    )),
  title text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, organization_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS contact_org_memberships_contact_idx
  ON public.contact_organization_memberships (contact_id);
CREATE INDEX IF NOT EXISTS contact_org_memberships_org_idx
  ON public.contact_organization_memberships (organization_id);

CREATE TABLE IF NOT EXISTS public.matter_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'other'
    CHECK (role IN (
      'primary_client', 'spouse', 'child', 'fiduciary', 'beneficiary',
      'referral_partner', 'notary', 'witness', 'attorney', 'staff',
      'vendor', 'other'
    )),
  relationship_label text,
  signing_role text CHECK (signing_role IS NULL OR signing_role IN ('notary', 'witness', 'signer', 'observer')),
  can_view_portal boolean NOT NULL DEFAULT false,
  can_view_documents boolean NOT NULL DEFAULT false,
  can_message_firm boolean NOT NULL DEFAULT false,
  notes text,
  active_from date,
  active_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, contact_id, role)
);

CREATE INDEX IF NOT EXISTS matter_contacts_matter_idx ON public.matter_contacts (matter_id);
CREATE INDEX IF NOT EXISTS matter_contacts_contact_idx ON public.matter_contacts (contact_id);
CREATE INDEX IF NOT EXISTS matter_contacts_role_idx ON public.matter_contacts (role);

CREATE TABLE IF NOT EXISTS public.lead_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'other'
    CHECK (role IN (
      'primary_lead', 'spouse', 'child', 'fiduciary', 'beneficiary',
      'referral_partner', 'notary', 'witness', 'professional', 'other'
    )),
  relationship_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, contact_id, role)
);

CREATE INDEX IF NOT EXISTS lead_contacts_lead_idx ON public.lead_contacts (lead_id);
CREATE INDEX IF NOT EXISTS lead_contacts_contact_idx ON public.lead_contacts (contact_id);
CREATE INDEX IF NOT EXISTS lead_contacts_role_idx ON public.lead_contacts (role);

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

ALTER TABLE public.referral_sources
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.contact_organizations(id) ON DELETE SET NULL;

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_intake_primary_contact_idx
  ON public.client_intake (primary_contact_id) WHERE primary_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_primary_contact_idx
  ON public.leads (primary_contact_id) WHERE primary_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_sources_contact_idx
  ON public.referral_sources (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_sources_organization_idx
  ON public.referral_sources (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calls_contact_id_idx
  ON public.calls (contact_id) WHERE contact_id IS NOT NULL;

-- Preserve existing household rows in the new matter/lead join tables.
INSERT INTO public.matter_contacts (matter_id, contact_id, role, relationship_label)
SELECT
  m.id,
  c.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.contact_roles cr WHERE cr.contact_id = c.id) THEN 'fiduciary'
    WHEN c.relationship_type IN ('spouse', 'child') THEN c.relationship_type
    WHEN c.relationship_type IN ('notary', 'witness') THEN c.relationship_type
    ELSE 'other'
  END,
  c.relationship_label
FROM public.matters m
JOIN public.contacts c ON c.client_intake_id = m.client_intake_id
WHERE m.client_intake_id IS NOT NULL
ON CONFLICT (matter_id, contact_id, role) DO NOTHING;

INSERT INTO public.lead_contacts (lead_id, contact_id, role, relationship_label)
SELECT
  ci.lead_id,
  c.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.contact_roles cr WHERE cr.contact_id = c.id) THEN 'fiduciary'
    WHEN c.relationship_type IN ('spouse', 'child') THEN c.relationship_type
    WHEN c.relationship_type IN ('notary', 'witness') THEN c.relationship_type
    WHEN c.relationship_type = 'professional' THEN 'professional'
    ELSE 'other'
  END,
  c.relationship_label
FROM public.client_intake ci
JOIN public.contacts c ON c.client_intake_id = ci.id
WHERE ci.lead_id IS NOT NULL
ON CONFLICT (lead_id, contact_id, role) DO NOTHING;

-- Seed organizations from current referral sources without creating duplicate
-- people yet; person-level de-duplication remains an explicit attorney action.
INSERT INTO public.contact_organizations (name, organization_type, phone, notes, is_active)
SELECT DISTINCT ON (lower(coalesce(nullif(firm_name, ''), name)))
  coalesce(nullif(firm_name, ''), name),
  CASE type
    WHEN 'attorney' THEN 'law_firm'
    WHEN 'financial_advisor' THEN 'financial_advisor'
    WHEN 'accountant' THEN 'accounting_firm'
    ELSE 'other'
  END,
  contact_phone,
  notes,
  is_active
FROM public.referral_sources
WHERE coalesce(nullif(firm_name, ''), name) IS NOT NULL
ORDER BY lower(coalesce(nullif(firm_name, ''), name)), updated_at DESC NULLS LAST;

UPDATE public.referral_sources rs
SET organization_id = co.id
FROM public.contact_organizations co
WHERE rs.organization_id IS NULL
  AND lower(co.name) = lower(coalesce(nullif(rs.firm_name, ''), rs.name));

CREATE OR REPLACE FUNCTION public.merge_contacts(p_winner_id uuid, p_loser_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  winner public.contacts%ROWTYPE;
  loser public.contacts%ROWTYPE;
  dropped_roles integer := 0;
  moved_roles integer := 0;
  moved_matter_links integer := 0;
  moved_lead_links integer := 0;
  moved_org_links integer := 0;
  moved_calls integer := 0;
  filled_fields text[] := ARRAY[]::text[];
BEGIN
  IF p_winner_id IS NULL OR p_loser_id IS NULL THEN
    RAISE EXCEPTION 'Both winner and loser contact ids are required.';
  END IF;

  IF p_winner_id = p_loser_id THEN
    RAISE EXCEPTION 'Winner and loser must be different contacts.';
  END IF;

  SELECT * INTO winner FROM public.contacts WHERE id = p_winner_id FOR UPDATE;
  IF winner.id IS NULL THEN
    RAISE EXCEPTION 'Winner contact not found.';
  END IF;

  SELECT * INTO loser FROM public.contacts WHERE id = p_loser_id FOR UPDATE;
  IF loser.id IS NULL THEN
    RAISE EXCEPTION 'Loser contact not found.';
  END IF;

  IF loser.relationship_type = 'spouse' AND loser.client_intake_id IS NOT NULL THEN
    RAISE EXCEPTION 'This spouse record is synced from the client intake and cannot be merged into another contact.';
  END IF;

  IF nullif(btrim(winner.first_name), '') IS NULL AND nullif(btrim(loser.first_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'first_name'); END IF;
  IF nullif(btrim(winner.middle_name), '') IS NULL AND nullif(btrim(loser.middle_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'middle_name'); END IF;
  IF nullif(btrim(winner.last_name), '') IS NULL AND nullif(btrim(loser.last_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'last_name'); END IF;
  IF nullif(btrim(winner.email), '') IS NULL AND nullif(btrim(loser.email), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'email'); END IF;
  IF nullif(btrim(winner.phone), '') IS NULL AND nullif(btrim(loser.phone), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'phone'); END IF;
  IF nullif(btrim(winner.address_line1), '') IS NULL AND nullif(btrim(loser.address_line1), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'address_line1'); END IF;
  IF nullif(btrim(winner.address_line2), '') IS NULL AND nullif(btrim(loser.address_line2), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'address_line2'); END IF;
  IF nullif(btrim(winner.city), '') IS NULL AND nullif(btrim(loser.city), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'city'); END IF;
  IF nullif(btrim(winner.state), '') IS NULL AND nullif(btrim(loser.state), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'state'); END IF;
  IF nullif(btrim(winner.zip), '') IS NULL AND nullif(btrim(loser.zip), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'zip'); END IF;
  IF nullif(btrim(winner.county), '') IS NULL AND nullif(btrim(loser.county), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'county'); END IF;
  IF nullif(btrim(winner.suffix), '') IS NULL AND nullif(btrim(loser.suffix), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'suffix'); END IF;
  IF nullif(btrim(winner.preferred_name), '') IS NULL AND nullif(btrim(loser.preferred_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'preferred_name'); END IF;
  IF nullif(btrim(winner.preferred_pronoun), '') IS NULL AND nullif(btrim(loser.preferred_pronoun), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'preferred_pronoun'); END IF;
  IF winner.date_of_birth IS NULL AND loser.date_of_birth IS NOT NULL THEN filled_fields := array_append(filled_fields, 'date_of_birth'); END IF;
  IF nullif(btrim(winner.relationship_type), '') IS NULL AND nullif(btrim(loser.relationship_type), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'relationship_type'); END IF;
  IF nullif(btrim(winner.relationship_label), '') IS NULL AND nullif(btrim(loser.relationship_label), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'relationship_label'); END IF;
  IF nullif(btrim(winner.organization_name), '') IS NULL AND nullif(btrim(loser.organization_name), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'organization_name'); END IF;
  IF nullif(btrim(winner.job_title), '') IS NULL AND nullif(btrim(loser.job_title), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'job_title'); END IF;
  IF nullif(btrim(winner.firm_notes), '') IS NULL AND nullif(btrim(loser.firm_notes), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'firm_notes'); END IF;
  IF nullif(btrim(winner.lawmatics_contact_id), '') IS NULL AND nullif(btrim(loser.lawmatics_contact_id), '') IS NOT NULL THEN filled_fields := array_append(filled_fields, 'lawmatics_contact_id'); END IF;
  IF winner.portal_user_id IS NULL AND loser.portal_user_id IS NOT NULL THEN filled_fields := array_append(filled_fields, 'portal_user_id'); END IF;

  DELETE FROM public.contact_roles loser_role
  WHERE loser_role.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1
      FROM public.contact_roles winner_role
      WHERE winner_role.contact_id = p_winner_id
        AND CASE WHEN winner_role.role = 'executor' THEN 'personal_rep' ELSE winner_role.role END =
            CASE WHEN loser_role.role = 'executor' THEN 'personal_rep' ELSE loser_role.role END
        AND winner_role.for_party = loser_role.for_party
        AND winner_role.priority = loser_role.priority
        AND coalesce(winner_role.is_coagent, false) = coalesce(loser_role.is_coagent, false)
    );
  GET DIAGNOSTICS dropped_roles = ROW_COUNT;

  UPDATE public.contact_roles SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS moved_roles = ROW_COUNT;

  DELETE FROM public.matter_contacts loser_link
  WHERE loser_link.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.matter_contacts winner_link
      WHERE winner_link.contact_id = p_winner_id
        AND winner_link.matter_id = loser_link.matter_id
        AND winner_link.role = loser_link.role
    );

  UPDATE public.matter_contacts SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS moved_matter_links = ROW_COUNT;

  DELETE FROM public.lead_contacts loser_link
  WHERE loser_link.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.lead_contacts winner_link
      WHERE winner_link.contact_id = p_winner_id
        AND winner_link.lead_id = loser_link.lead_id
        AND winner_link.role = loser_link.role
    );

  UPDATE public.lead_contacts SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS moved_lead_links = ROW_COUNT;

  DELETE FROM public.contact_organization_memberships loser_link
  WHERE loser_link.contact_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.contact_organization_memberships winner_link
      WHERE winner_link.contact_id = p_winner_id
        AND winner_link.organization_id = loser_link.organization_id
        AND winner_link.relationship_type = loser_link.relationship_type
    );

  UPDATE public.contact_organization_memberships SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS moved_org_links = ROW_COUNT;

  UPDATE public.calls SET contact_id = p_winner_id WHERE contact_id = p_loser_id;
  GET DIAGNOSTICS moved_calls = ROW_COUNT;

  UPDATE public.client_intake SET primary_contact_id = p_winner_id WHERE primary_contact_id = p_loser_id;
  UPDATE public.leads SET primary_contact_id = p_winner_id WHERE primary_contact_id = p_loser_id;
  UPDATE public.referral_sources SET contact_id = p_winner_id WHERE contact_id = p_loser_id;

  UPDATE public.contacts
  SET lawmatics_contact_id = NULL,
      portal_user_id = NULL
  WHERE id = p_loser_id;

  UPDATE public.contacts
  SET first_name = coalesce(nullif(btrim(winner.first_name), ''), loser.first_name),
      middle_name = coalesce(nullif(btrim(winner.middle_name), ''), loser.middle_name),
      last_name = coalesce(nullif(btrim(winner.last_name), ''), loser.last_name),
      email = coalesce(nullif(btrim(winner.email), ''), loser.email),
      phone = coalesce(nullif(btrim(winner.phone), ''), loser.phone),
      address_line1 = coalesce(nullif(btrim(winner.address_line1), ''), loser.address_line1),
      address_line2 = coalesce(nullif(btrim(winner.address_line2), ''), loser.address_line2),
      city = coalesce(nullif(btrim(winner.city), ''), loser.city),
      state = coalesce(nullif(btrim(winner.state), ''), loser.state),
      zip = coalesce(nullif(btrim(winner.zip), ''), loser.zip),
      county = coalesce(nullif(btrim(winner.county), ''), loser.county),
      suffix = coalesce(nullif(btrim(winner.suffix), ''), loser.suffix),
      preferred_name = coalesce(nullif(btrim(winner.preferred_name), ''), loser.preferred_name),
      preferred_pronoun = coalesce(nullif(btrim(winner.preferred_pronoun), ''), loser.preferred_pronoun),
      date_of_birth = coalesce(winner.date_of_birth, loser.date_of_birth),
      relationship_type = coalesce(nullif(btrim(winner.relationship_type), ''), loser.relationship_type),
      relationship_label = coalesce(nullif(btrim(winner.relationship_label), ''), loser.relationship_label),
      organization_name = coalesce(nullif(btrim(winner.organization_name), ''), loser.organization_name),
      job_title = coalesce(nullif(btrim(winner.job_title), ''), loser.job_title),
      firm_notes = coalesce(nullif(btrim(winner.firm_notes), ''), loser.firm_notes),
      tags = coalesce((
        SELECT array_agg(DISTINCT tag)
        FROM unnest(coalesce(winner.tags, ARRAY[]::text[]) || coalesce(loser.tags, ARRAY[]::text[])) AS tag
        WHERE nullif(btrim(tag), '') IS NOT NULL
      ), ARRAY[]::text[]),
      lawmatics_contact_id = coalesce(nullif(btrim(winner.lawmatics_contact_id), ''), loser.lawmatics_contact_id),
      portal_user_id = coalesce(winner.portal_user_id, loser.portal_user_id),
      updated_at = now()
  WHERE id = p_winner_id;

  DELETE FROM public.contacts WHERE id = p_loser_id;

  RETURN jsonb_build_object(
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'moved_roles', moved_roles,
    'dropped_roles', dropped_roles,
    'moved_matter_links', moved_matter_links,
    'moved_lead_links', moved_lead_links,
    'moved_org_links', moved_org_links,
    'moved_calls', moved_calls,
    'filled_fields', filled_fields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_firm_contacts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_organizations_updated_at ON public.contact_organizations;
CREATE TRIGGER trg_contact_organizations_updated_at
BEFORE UPDATE ON public.contact_organizations
FOR EACH ROW EXECUTE FUNCTION public.set_firm_contacts_updated_at();

DROP TRIGGER IF EXISTS trg_contact_org_memberships_updated_at ON public.contact_organization_memberships;
CREATE TRIGGER trg_contact_org_memberships_updated_at
BEFORE UPDATE ON public.contact_organization_memberships
FOR EACH ROW EXECUTE FUNCTION public.set_firm_contacts_updated_at();

DROP TRIGGER IF EXISTS trg_matter_contacts_updated_at ON public.matter_contacts;
CREATE TRIGGER trg_matter_contacts_updated_at
BEFORE UPDATE ON public.matter_contacts
FOR EACH ROW EXECUTE FUNCTION public.set_firm_contacts_updated_at();

DROP TRIGGER IF EXISTS trg_lead_contacts_updated_at ON public.lead_contacts;
CREATE TRIGGER trg_lead_contacts_updated_at
BEFORE UPDATE ON public.lead_contacts
FOR EACH ROW EXECUTE FUNCTION public.set_firm_contacts_updated_at();

CREATE OR REPLACE FUNCTION public.calls_autoassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits text;
  matched_lead uuid;
  matched_matter uuid;
  matched_contact uuid;
BEGIN
  digits := public.normalize_us_phone(new.participant_number);
  new.participant_digits := digits;

  IF digits IS NOT NULL THEN
    IF new.contact_id IS NULL THEN
      SELECT id INTO matched_contact
      FROM public.contacts
      WHERE public.normalize_us_phone(phone) = digits
        AND crm_status <> 'archived'
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1;

      IF matched_contact IS NOT NULL THEN
        new.contact_id := matched_contact;
      END IF;
    END IF;

    IF new.lead_id IS NULL AND new.matter_id IS NULL THEN
      -- Prefer an existing matter whose client_intake.phone matches.
      SELECT m.id INTO matched_matter
      FROM public.matters m
      JOIN public.client_intake ci ON ci.id = m.client_intake_id
      WHERE public.normalize_us_phone(ci.phone) = digits
      ORDER BY m.created_at DESC
      LIMIT 1;

      IF matched_matter IS NOT NULL THEN
        new.matter_id := matched_matter;
      ELSE
        SELECT id INTO matched_lead
        FROM public.leads
        WHERE deleted_at IS NULL
          AND public.normalize_us_phone(phone) = digits
        ORDER BY created_at DESC
        LIMIT 1;
        IF matched_lead IS NOT NULL THEN
          new.lead_id := matched_lead;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN new;
END;
$$;

ALTER TABLE public.contact_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "firm_staff_manage_contact_organizations" ON public.contact_organizations;
CREATE POLICY "firm_staff_manage_contact_organizations"
  ON public.contact_organizations
  FOR ALL TO authenticated
  USING (is_attorney_or_staff())
  WITH CHECK (is_attorney_or_staff());

DROP POLICY IF EXISTS "firm_staff_manage_contact_org_memberships" ON public.contact_organization_memberships;
CREATE POLICY "firm_staff_manage_contact_org_memberships"
  ON public.contact_organization_memberships
  FOR ALL TO authenticated
  USING (is_attorney_or_staff())
  WITH CHECK (is_attorney_or_staff());

DROP POLICY IF EXISTS "firm_staff_manage_matter_contacts" ON public.matter_contacts;
CREATE POLICY "firm_staff_manage_matter_contacts"
  ON public.matter_contacts
  FOR ALL TO authenticated
  USING (is_attorney_or_staff())
  WITH CHECK (is_attorney_or_staff());

DROP POLICY IF EXISTS "firm_staff_manage_lead_contacts" ON public.lead_contacts;
CREATE POLICY "firm_staff_manage_lead_contacts"
  ON public.lead_contacts
  FOR ALL TO authenticated
  USING (is_attorney_or_staff())
  WITH CHECK (is_attorney_or_staff());

COMMENT ON TABLE public.contact_organizations IS
  'Organizations associated with firm contacts, referral partners, vendors, and signing resources.';
COMMENT ON TABLE public.contact_organization_memberships IS
  'Links canonical contacts to organizations with titles and relationship context.';
COMMENT ON TABLE public.matter_contacts IS
  'Matter-specific contact roles such as spouse, fiduciary, notary, witness, referral partner, and staff.';
COMMENT ON TABLE public.lead_contacts IS
  'Lead-specific contact roles before conversion to a matter.';
