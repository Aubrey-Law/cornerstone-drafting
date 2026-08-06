drop extension if exists "pg_net";

create schema if not exists "box_private";

drop view if exists "public"."v_communication_threads";

drop view if exists "public"."v_cornerstone_crm_opportunities";

drop view if exists "public"."v_cornerstone_crm_parity";

drop view if exists "public"."v_cornerstone_crm_people";

drop view if exists "public"."v_matter_pipeline";

drop view if exists "public"."v_matter_pipeline_all";

drop view if exists "public"."v_pipeline_aging";

drop view if exists "public"."v_matter_aging";


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

CREATE OR REPLACE FUNCTION public.calls_autoassign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  digits text;
  matched_matter uuid;
  matched_lead uuid;
  matched_contact uuid;
  contact_intake uuid;
BEGIN
  digits := public.normalize_us_phone(NEW.participant_number);
  NEW.participant_digits := digits;

  IF digits IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.matter_id IS NULL AND NEW.lead_id IS NULL THEN
    SELECT m.id INTO matched_matter
    FROM public.matters m
    JOIN public.client_intake ci ON ci.id = m.client_intake_id
    WHERE public.normalize_us_phone(ci.phone) = digits
      AND coalesce(m.relationship_status, 'hired') = 'hired'
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF matched_matter IS NOT NULL THEN
      NEW.matter_id := matched_matter::text;
    ELSE
      SELECT ci.id INTO matched_lead
      FROM public.client_intake ci
      LEFT JOIN public.matters m ON m.id = ci.matter_id
      WHERE public.normalize_us_phone(ci.phone) = digits
        AND coalesce(m.relationship_status, 'hired') <> 'hired'
      ORDER BY ci.updated_at DESC
      LIMIT 1;

      IF matched_lead IS NOT NULL THEN
        NEW.lead_id := matched_lead;
      END IF;
    END IF;
  END IF;

  IF NEW.contact_id IS NULL AND NEW.matter_id IS NULL AND NEW.lead_id IS NULL THEN
    SELECT c.id, c.client_intake_id INTO matched_contact, contact_intake
    FROM public.contacts c
    WHERE public.normalize_us_phone(c.phone) = digits
      AND coalesce(c.deceased, false) = false
    ORDER BY c.created_at DESC
    LIMIT 1;

    IF matched_contact IS NOT NULL THEN
      NEW.contact_id := matched_contact;

      IF contact_intake IS NOT NULL THEN
        SELECT m.id INTO matched_matter
        FROM public.matters m
        WHERE m.client_intake_id = contact_intake
          AND coalesce(m.relationship_status, 'hired') = 'hired'
        ORDER BY m.created_at DESC
        LIMIT 1;

        IF matched_matter IS NOT NULL THEN
          NEW.matter_id := matched_matter::text;
        ELSE
          NEW.lead_id := contact_intake;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_billing_item(p_matter_id uuid, p_kind text, p_label text, p_plan text, p_amount_billed integer, p_actor_id uuid)
 RETURNS public.billing_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_item public.billing_items;
  v_label text := btrim(coalesce(p_label, ''));
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or admin access required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.matters m WHERE m.id = p_matter_id) THEN
    RAISE EXCEPTION 'Matter not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('flat_fee', 'plan_claim', 'cost') THEN
    RAISE EXCEPTION 'Unknown charge type' USING ERRCODE = '22023';
  END IF;

  IF v_label = '' THEN
    RAISE EXCEPTION 'Label is required' USING ERRCODE = '22023';
  END IF;

  IF p_amount_billed IS NULL OR p_amount_billed <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'plan_claim' AND p_plan IS NULL THEN
    RAISE EXCEPTION 'A plan claim requires a legal plan' USING ERRCODE = '22023';
  END IF;
  IF p_kind <> 'plan_claim' AND p_plan IS NOT NULL THEN
    RAISE EXCEPTION 'Only plan claims carry a legal plan' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.billing_items (
    matter_id, kind, label, plan, amount_billed, status, source, created_by, updated_by
  )
  VALUES (
    p_matter_id, p_kind, v_label, p_plan, p_amount_billed, 'to_invoice', 'manual',
    p_actor_id, p_actor_id
  )
  RETURNING * INTO v_item;

  INSERT INTO public.billing_events (
    billing_item_id, event_type, actor_id, detail, metadata
  )
  VALUES (
    v_item.id,
    'item_created',
    p_actor_id,
    format('%s added: %s', initcap(replace(p_kind, '_', ' ')), v_label),
    jsonb_build_object('kind', p_kind, 'plan', p_plan, 'amount_billed', p_amount_billed)
  );

  RETURN v_item;
END
$function$
;

CREATE OR REPLACE FUNCTION public.sms_messages_autoassign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  participant text;
  digits text;
  matched_matter uuid;
  matched_intake uuid;
  matched_contact uuid;
  contact_intake uuid;
BEGIN
  participant := CASE
    WHEN NEW.direction = 'inbound' THEN NEW.from_number
    ELSE NEW.to_number
  END;

  digits := public.normalize_us_phone(participant);
  IF digits IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT ci.id INTO matched_intake
  FROM public.client_intake ci
  WHERE public.normalize_us_phone(ci.phone) = digits
  ORDER BY ci.created_at DESC
  LIMIT 1;

  IF NEW.lead_id IS NULL AND matched_intake IS NOT NULL THEN
    NEW.lead_id := matched_intake;
  END IF;

  IF NEW.matter_id IS NULL AND matched_intake IS NOT NULL THEN
    SELECT m.id INTO matched_matter
    FROM public.matters m
    WHERE m.client_intake_id = matched_intake
    ORDER BY m.created_at DESC
    LIMIT 1;

    IF matched_matter IS NOT NULL THEN
      NEW.matter_id := matched_matter::text;
    END IF;
  END IF;

  IF NEW.contact_id IS NULL AND matched_intake IS NULL THEN
    SELECT c.id, c.client_intake_id INTO matched_contact, contact_intake
    FROM public.contacts c
    WHERE public.normalize_us_phone(c.phone) = digits
      AND coalesce(c.deceased, false) = false
    ORDER BY c.created_at DESC
    LIMIT 1;

    IF matched_contact IS NOT NULL THEN
      NEW.contact_id := matched_contact;

      IF NEW.matter_id IS NULL AND contact_intake IS NOT NULL THEN
        SELECT m.id INTO matched_matter
        FROM public.matters m
        WHERE m.client_intake_id = contact_intake
        ORDER BY m.created_at DESC
        LIMIT 1;

        IF matched_matter IS NOT NULL THEN
          NEW.matter_id := matched_matter::text;
        END IF;
      END IF;

      IF NEW.lead_id IS NULL THEN
        NEW.lead_id := contact_intake;
      END IF;

      IF NEW.recipient_name IS NULL OR trim(NEW.recipient_name) = '' THEN
        SELECT nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')
        INTO NEW.recipient_name
        FROM public.contacts c
        WHERE c.id = matched_contact;
      END IF;
    END IF;
  END IF;

  IF (NEW.recipient_name IS NULL OR trim(NEW.recipient_name) = '')
     AND NEW.matter_id IS NOT NULL THEN
    SELECT coalesce(
      nullif(trim(coalesce(ci.first_name, '') || ' ' || coalesce(ci.last_name, '')), ''),
      'Client'
    )
    INTO NEW.recipient_name
    FROM public.matters m
    JOIN public.client_intake ci ON ci.id = m.client_intake_id
    WHERE m.id::text = NEW.matter_id;
  END IF;

  RETURN NEW;
END;
$function$
;

create or replace view "public"."v_communication_threads" as  WITH items AS (
         SELECT m.matter_id,
            NULL::uuid AS lead_id,
            NULL::uuid AS contact_id,
            'portal'::text AS channel,
                CASE
                    WHEN (m.sender_role = 'client'::text) THEN 'inbound'::text
                    ELSE 'outbound'::text
                END AS direction,
            m.body AS preview,
            m.created_at AS occurred_at,
            ((m.sender_role = 'client'::text) AND (m.read_at IS NULL)) AS unread,
            (m.sender_role = 'client'::text) AS needs_response
           FROM public.messages m
        UNION ALL
         SELECT s.matter_id,
            s.lead_id,
            s.contact_id,
            'sms'::text,
            s.direction,
            s.body,
            s.created_at,
            ((s.direction = 'inbound'::text) AND (s.read_by_staff_at IS NULL)),
            (s.direction = 'inbound'::text)
           FROM public.sms_messages s
        UNION ALL
         SELECT c.matter_id,
            c.lead_id,
            c.contact_id,
            'call'::text,
            c.direction,
            COALESCE(NULLIF(TRIM(BOTH FROM c.summary), ''::text), (initcap(c.direction) || ' call'::text)) AS "coalesce",
            c.started_at,
            false,
            ((c.direction = 'inbound'::text) AND ((c.voicemail_url IS NOT NULL) OR (c.status = ANY (ARRAY['missed'::text, 'no-answer'::text, 'voicemail'::text]))))
           FROM public.calls c
        UNION ALL
         SELECT e.matter_id,
            e.lead_id,
            e.contact_id,
            'email'::text,
            'outbound'::text,
            e.subject,
            e.created_at,
            false,
            false
           FROM public.email_log e
          WHERE (e.status <> 'error'::text)
        ), keyed AS (
         SELECT
                CASE
                    WHEN (items.contact_id IS NOT NULL) THEN ('contact:'::text || (items.contact_id)::text)
                    WHEN (items.matter_id IS NOT NULL) THEN ('matter:'::text || items.matter_id)
                    ELSE ('lead:'::text || (items.lead_id)::text)
                END AS thread_key,
                CASE
                    WHEN (items.contact_id IS NOT NULL) THEN 'contact'::text
                    WHEN (items.matter_id IS NOT NULL) THEN 'matter'::text
                    ELSE 'lead'::text
                END AS record_type,
                CASE
                    WHEN (items.contact_id IS NULL) THEN items.matter_id
                    ELSE NULL::text
                END AS matter_id,
                CASE
                    WHEN (items.contact_id IS NULL) THEN items.lead_id
                    ELSE NULL::uuid
                END AS lead_id,
            items.contact_id,
            items.channel,
            items.direction,
            items.preview,
            items.occurred_at,
            items.unread,
            items.needs_response
           FROM items
          WHERE ((items.matter_id IS NOT NULL) OR (items.lead_id IS NOT NULL) OR (items.contact_id IS NOT NULL))
        ), agg AS (
         SELECT keyed.thread_key,
            min(keyed.record_type) AS record_type,
            min(keyed.matter_id) AS matter_id,
            (min((keyed.lead_id)::text))::uuid AS lead_id,
            (min((keyed.contact_id)::text))::uuid AS contact_id,
            max(keyed.occurred_at) AS last_message_at,
            array_agg(DISTINCT keyed.channel ORDER BY keyed.channel) AS channels,
            count(*) FILTER (WHERE keyed.unread) AS unread_count,
            max(keyed.occurred_at) FILTER (WHERE keyed.needs_response) AS last_attention_at,
            max(keyed.occurred_at) FILTER (WHERE (keyed.direction = 'outbound'::text)) AS last_outbound_at
           FROM keyed
          GROUP BY keyed.thread_key
        ), latest AS (
         SELECT DISTINCT ON (keyed.thread_key) keyed.thread_key,
            keyed.channel AS last_channel,
            keyed.direction AS last_direction,
            keyed.preview AS last_preview
           FROM keyed
          ORDER BY keyed.thread_key, keyed.occurred_at DESC, keyed.channel
        )
 SELECT a.thread_key,
    a.record_type,
    a.matter_id,
    a.lead_id,
    a.contact_id,
        CASE
            WHEN (a.record_type = 'contact'::text) THEN COALESCE(NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cc.first_name, cc.last_name)), ''::text), NULLIF(TRIM(BOTH FROM cc.preferred_name), ''::text), cc.email, 'Contact'::text)
            WHEN (a.record_type = 'matter'::text) THEN COALESCE(NULLIF(TRIM(BOTH FROM mm.name), ''::text), 'Matter'::text)
            ELSE COALESCE(NULLIF(TRIM(BOTH FROM ci.full_name), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)), ''::text), ci.email, 'Lead'::text)
        END AS display_name,
    COALESCE(cc.phone, ci.phone, mci.phone) AS contact_phone,
    COALESCE(cc.email, ci.email, mci.email) AS contact_email,
    mm.matter_number,
    mm.stage,
    l.last_channel,
    l.last_direction,
    l.last_preview,
    a.last_message_at,
    a.channels,
    a.unread_count,
        CASE
            WHEN (a.last_attention_at > COALESCE(a.last_outbound_at, '-infinity'::timestamp with time zone)) THEN a.last_attention_at
            ELSE NULL::timestamp with time zone
        END AS waiting_since,
    st.snoozed_until,
    st.archived_at,
    st.marked_unread_at,
    st.assigned_to
   FROM ((((((agg a
     LEFT JOIN public.matters mm ON (((mm.id)::text = a.matter_id)))
     LEFT JOIN public.client_intake mci ON ((mci.id = mm.client_intake_id)))
     LEFT JOIN public.client_intake ci ON ((ci.id = a.lead_id)))
     LEFT JOIN public.contacts cc ON ((cc.id = a.contact_id)))
     LEFT JOIN public.communication_thread_state st ON ((st.thread_key = a.thread_key)))
     LEFT JOIN latest l ON ((l.thread_key = a.thread_key)));


create or replace view "public"."v_cornerstone_crm_parity" as  SELECT 'intake_people'::text AS entity,
    ( SELECT count(*) AS count
           FROM public.client_intake) AS source_count,
    ( SELECT count(*) AS count
           FROM public.cornerstone_crm_people
          WHERE (cornerstone_crm_people.client_intake_id IS NOT NULL)) AS crm_count
UNION ALL
 SELECT 'contact_people'::text AS entity,
    ( SELECT count(*) AS count
           FROM public.contacts
          WHERE ((TRIM(BOTH FROM concat_ws(' '::text, contacts.first_name, contacts.last_name)) <> ''::text) AND (lower(TRIM(BOTH FROM concat_ws(' '::text, contacts.first_name, contacts.last_name))) <> ALL (ARRAY['tbd'::text, 'to be determined'::text])))) AS source_count,
    ( SELECT count(*) AS count
           FROM public.cornerstone_crm_people
          WHERE (cornerstone_crm_people.contact_id IS NOT NULL)) AS crm_count
UNION ALL
 SELECT 'opportunities'::text AS entity,
    ( SELECT count(*) AS count
           FROM public.client_intake) AS source_count,
    ( SELECT count(*) AS count
           FROM public.cornerstone_crm_opportunities
          WHERE (cornerstone_crm_opportunities.client_intake_id IS NOT NULL)) AS crm_count
UNION ALL
 SELECT 'activities'::text AS entity,
    ( SELECT count(*) AS count
           FROM public.lead_activity) AS source_count,
    ( SELECT count(*) AS count
           FROM public.cornerstone_crm_activities
          WHERE (cornerstone_crm_activities.source_type = 'lead_activity'::text)) AS crm_count;


create or replace view "public"."v_cornerstone_crm_people" as  SELECT p.id,
    p.client_intake_id,
    p.contact_id,
    p.person_kind,
    p.record_status,
    COALESCE(ci.first_name, c.first_name) AS first_name,
    COALESCE(ci.last_name, c.last_name) AS last_name,
    COALESCE(NULLIF(TRIM(BOTH FROM ci.full_name), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.preferred_name, ci.last_name)), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.preferred_name, c.last_name)), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, c.first_name, c.last_name)), ''::text), p.company_name, 'Unnamed person'::text) AS name,
    COALESCE(NULLIF(TRIM(BOTH FROM ci.email), ''::text), NULLIF(TRIM(BOTH FROM c.email), ''::text)) AS email,
    COALESCE(NULLIF(TRIM(BOTH FROM ci.phone), ''::text), NULLIF(TRIM(BOTH FROM c.phone), ''::text)) AS phone,
    COALESCE(ci.city, c.city) AS city,
    COALESCE(ci.state, c.state) AS state,
    p.country,
    ci.practice_area,
    ci.lead_source,
    ci.referral_source,
    ci.matter_id,
    c.client_intake_id AS related_intake_id,
    c.relationship_type,
    c.relationship_label,
    p.lifecycle_status,
    p.owner_user_id,
    p.assigned_to_user_id,
    p.next_follow_up_at,
    p.last_engagement_at,
    p.marketing_status,
    p.marketing_segment,
    p.topic_preferences,
    p.preferred_frequency,
    p.duplicate_review_status,
    p.stage_id,
    s.name AS stage_name,
    s.slug AS stage_slug,
    p.sync_state,
    p.twenty_contact_id,
    p.created_at,
    p.updated_at,
    p.lead_id,
    p.company_name,
    ci.matter_id AS cornerstone_matter_id
   FROM (((public.cornerstone_crm_people p
     LEFT JOIN public.client_intake ci ON ((ci.id = p.client_intake_id)))
     LEFT JOIN public.contacts c ON ((c.id = p.contact_id)))
     LEFT JOIN public.cornerstone_crm_stages s ON ((s.id = p.stage_id)));


create or replace view "public"."v_matter_aging" as  WITH base AS (
         SELECT 'matter'::text AS entity,
            (m.id)::text AS id,
            COALESCE(NULLIF(TRIM(BOTH FROM m.name), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)), ''::text)) AS client_name,
            ci.email AS client_email,
            ci.phone AS client_phone,
            COALESCE(NULLIF(m.track, ''::text), 'DEFAULT'::text) AS track,
            public.map_matter_stage_to_engine(m.stage) AS current_stage,
            s.stage_order,
            s.owner,
            COALESCE(m.stage_entered_at, m.created_at) AS stage_entered_at,
            public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) AS days_in_stage,
            s.sla_days,
            s.escalation_offset,
            ((s.sla_days IS NOT NULL) AND (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) > s.sla_days)) AS is_overdue,
            ((s.escalation_offset IS NOT NULL) AND (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= s.escalation_offset)) AS needs_outreach,
                CASE
                    WHEN (s.sla_days IS NULL) THEN 'green'::text
                    WHEN (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) > s.sla_days) THEN 'red'::text
                    WHEN ((s.escalation_offset IS NOT NULL) AND (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= s.escalation_offset)) THEN 'red'::text
                    WHEN (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= (s.sla_days - 1)) THEN 'amber'::text
                    ELSE 'green'::text
                END AS raw_health,
                CASE
                    WHEN (s.sla_days IS NULL) THEN NULL::integer
                    ELSE (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) - s.sla_days)
                END AS days_over_sla
           FROM ((public.matters m
             LEFT JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
             JOIN public.stage_sla s ON (((s.stage_key = public.map_matter_stage_to_engine(m.stage)) AND (s.track = COALESCE(NULLIF(m.track, ''::text), 'DEFAULT'::text)) AND (s.entity = 'matter'::text))))
          WHERE ((m.status = 'active'::text) AND (m.relationship_status = 'hired'::text) AND (public.map_matter_stage_to_engine(m.stage) IS NOT NULL) AND (public.map_matter_stage_to_engine(m.stage) <> 'matter_closed'::text))
        )
 SELECT b.entity,
    b.id,
    b.client_name,
    b.client_email,
    b.client_phone,
    b.track,
    b.current_stage,
    b.stage_order,
    b.owner,
    b.stage_entered_at,
    b.days_in_stage,
    b.sla_days,
    b.escalation_offset,
        CASE
            WHEN (sn.id IS NOT NULL) THEN false
            ELSE b.is_overdue
        END AS is_overdue,
        CASE
            WHEN (sn.id IS NOT NULL) THEN false
            ELSE b.needs_outreach
        END AS needs_outreach,
        CASE
            WHEN (sn.id IS NOT NULL) THEN 'green'::text
            ELSE b.raw_health
        END AS health,
    b.raw_health,
    b.days_over_sla,
    sn.id AS snooze_id,
    sn.snoozed_until,
    sn.reason AS snooze_reason,
    (sn.id IS NOT NULL) AS is_snoozed
   FROM (base b
     LEFT JOIN public.pipeline_aging_snooze sn ON (((sn.entity = 'matter'::text) AND (sn.entity_id = b.id) AND (sn.stage_key = b.current_stage) AND (sn.snoozed_until > now()))));


create or replace view "public"."v_matter_pipeline" as  SELECT m.id AS matter_id,
    m.name AS matter_name,
    m.stage,
    m.status,
    m.flags,
    m.created_at AS matter_created,
    TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)) AS client_name,
    ci.email AS client_email,
    ci.phone AS client_phone,
    ci.date_of_birth AS client_dob,
    NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.address_line1, ci.address_line2)), ''::text), NULLIF(ci.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.state, ci.zip)), ''::text)), ''::text) AS client_address,
    NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cs.first_name, cs.last_name)), ''::text) AS spouse_name,
    cs.email AS spouse_email,
    cs.phone AS spouse_phone,
    cs.date_of_birth AS spouse_dob,
    NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.address_line1, ci.address_line2)), ''::text), NULLIF(ci.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.state, ci.zip)), ''::text)), ''::text) AS spouse_address,
    ci.plan_type,
    ci.marital_status,
    ci.has_minor_children,
    ci.taxable_estate,
    ci.status AS intake_status,
    ci.intake_sent_at,
    ds.status AS design_status,
    m.intake_submitted_at,
    m.drafts_sent_at,
    m.signing_date,
    m.documents_executed_at,
    NULL::timestamp with time zone AS next_appointment,
    NULL::text AS next_appointment_type,
    md.practice_area,
    md.referral_source,
    md.flat_fee_amount AS fee_amount,
    (md.open_date)::timestamp with time zone AS opened_at,
    md.client_status
   FROM ((((public.matters m
     JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
     LEFT JOIN public.contacts cs ON (((cs.client_intake_id = ci.id) AND (cs.relationship_type = 'spouse'::text))))
     LEFT JOIN public.design_sheets ds ON ((ds.matter_id = m.id)))
     LEFT JOIN public.matter_details md ON ((md.client_id = m.id)))
  WHERE ((m.status <> 'archived'::text) AND (m.relationship_status = 'hired'::text));


create or replace view "public"."v_matter_pipeline_all" as  SELECT m.id AS matter_id,
    m.relationship_status,
    m.matter_number,
    m.name AS matter_name,
    m.stage,
    m.status,
    m.flags,
    m.created_at AS matter_created,
    TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)) AS client_name,
    ci.email AS client_email,
    ci.phone AS client_phone,
    ci.date_of_birth AS client_dob,
    NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.address_line1, ci.address_line2)), ''::text), NULLIF(ci.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.state, ci.zip)), ''::text)), ''::text) AS client_address,
    NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cs.first_name, cs.last_name)), ''::text) AS spouse_name,
    cs.email AS spouse_email,
    cs.phone AS spouse_phone,
    cs.date_of_birth AS spouse_dob,
    NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.address_line1, ci.address_line2)), ''::text), NULLIF(ci.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.state, ci.zip)), ''::text)), ''::text) AS spouse_address,
    ci.plan_type,
    ci.marital_status,
    ci.has_minor_children,
    ci.taxable_estate,
    ci.status AS intake_status,
    ci.intake_sent_at,
    ds.status AS design_status,
    m.intake_submitted_at,
    m.drafts_sent_at,
    m.signing_date,
    m.documents_executed_at,
    NULL::timestamp with time zone AS next_appointment,
    NULL::text AS next_appointment_type,
    md.practice_area,
    md.referral_source,
    md.flat_fee_amount AS fee_amount,
    (md.open_date)::timestamp with time zone AS opened_at,
    md.client_status
   FROM ((((public.matters m
     JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
     LEFT JOIN public.contacts cs ON (((cs.client_intake_id = ci.id) AND (cs.relationship_type = 'spouse'::text))))
     LEFT JOIN public.design_sheets ds ON ((ds.matter_id = m.id)))
     LEFT JOIN public.matter_details md ON ((md.client_id = m.id)))
  WHERE (m.status <> 'archived'::text);


create or replace view "public"."v_pipeline_aging" as  WITH lead_base AS (
         SELECT 'lead'::text AS entity,
            (ci.id)::text AS id,
            COALESCE(NULLIF(TRIM(BOTH FROM ci.full_name), ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)), ''::text), ci.email) AS client_name,
            ci.email AS client_email,
            ci.phone AS client_phone,
            COALESCE(NULLIF(m.track, ''::text), 'DEFAULT'::text) AS track,
            m.stage AS current_stage,
            s.stage_order,
            s.owner,
            COALESCE(m.stage_entered_at, m.created_at) AS stage_entered_at,
            public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) AS days_in_stage,
            s.sla_days,
            s.escalation_offset,
            ((s.sla_days IS NOT NULL) AND (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) > s.sla_days)) AS is_overdue,
            ((s.escalation_offset IS NOT NULL) AND (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= s.escalation_offset)) AS needs_outreach,
                CASE
                    WHEN (s.sla_days IS NULL) THEN 'green'::text
                    WHEN (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) > s.sla_days) THEN 'red'::text
                    WHEN ((s.escalation_offset IS NOT NULL) AND (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= s.escalation_offset)) THEN 'red'::text
                    WHEN (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= (s.sla_days - 1)) THEN 'amber'::text
                    ELSE 'green'::text
                END AS raw_health,
                CASE
                    WHEN (s.sla_days IS NULL) THEN NULL::integer
                    ELSE (public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) - s.sla_days)
                END AS days_over_sla
           FROM ((public.matters m
             JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
             JOIN public.stage_sla s ON (((s.stage_key = m.stage) AND (s.track = COALESCE(NULLIF(m.track, ''::text), 'DEFAULT'::text)) AND (s.entity = 'lead'::text))))
          WHERE ((m.status = 'active'::text) AND (m.relationship_status = 'lead'::text))
        ), lead_aging AS (
         SELECT b.entity,
            b.id,
            b.client_name,
            b.client_email,
            b.client_phone,
            b.track,
            b.current_stage,
            b.stage_order,
            b.owner,
            b.stage_entered_at,
            b.days_in_stage,
            b.sla_days,
            b.escalation_offset,
                CASE
                    WHEN (sn.id IS NOT NULL) THEN false
                    ELSE b.is_overdue
                END AS is_overdue,
                CASE
                    WHEN (sn.id IS NOT NULL) THEN false
                    ELSE b.needs_outreach
                END AS needs_outreach,
                CASE
                    WHEN (sn.id IS NOT NULL) THEN 'green'::text
                    ELSE b.raw_health
                END AS health,
            b.raw_health,
            b.days_over_sla,
            sn.id AS snooze_id,
            sn.snoozed_until,
            sn.reason AS snooze_reason,
            (sn.id IS NOT NULL) AS is_snoozed
           FROM (lead_base b
             LEFT JOIN public.pipeline_aging_snooze sn ON (((sn.entity = 'lead'::text) AND (sn.entity_id = b.id) AND (sn.stage_key = b.current_stage) AND (sn.snoozed_until > now()))))
        )
 SELECT v_matter_aging.entity,
    v_matter_aging.id,
    v_matter_aging.client_name,
    v_matter_aging.client_email,
    v_matter_aging.client_phone,
    v_matter_aging.track,
    v_matter_aging.current_stage,
    v_matter_aging.stage_order,
    v_matter_aging.owner,
    v_matter_aging.stage_entered_at,
    v_matter_aging.days_in_stage,
    v_matter_aging.sla_days,
    v_matter_aging.escalation_offset,
    v_matter_aging.is_overdue,
    v_matter_aging.needs_outreach,
    v_matter_aging.health,
    v_matter_aging.raw_health,
    v_matter_aging.days_over_sla,
    v_matter_aging.snooze_id,
    v_matter_aging.snoozed_until,
    v_matter_aging.snooze_reason,
    v_matter_aging.is_snoozed
   FROM public.v_matter_aging
UNION ALL
 SELECT lead_aging.entity,
    lead_aging.id,
    lead_aging.client_name,
    lead_aging.client_email,
    lead_aging.client_phone,
    lead_aging.track,
    lead_aging.current_stage,
    lead_aging.stage_order,
    lead_aging.owner,
    lead_aging.stage_entered_at,
    lead_aging.days_in_stage,
    lead_aging.sla_days,
    lead_aging.escalation_offset,
    lead_aging.is_overdue,
    lead_aging.needs_outreach,
    lead_aging.health,
    lead_aging.raw_health,
    lead_aging.days_over_sla,
    lead_aging.snooze_id,
    lead_aging.snoozed_until,
    lead_aging.snooze_reason,
    lead_aging.is_snoozed
   FROM lead_aging;


create or replace view "public"."v_cornerstone_crm_opportunities" as  SELECT o.id,
    o.person_id,
    o.title,
    o.stage_id,
    o.confidence_score,
    o.expected_value,
    o.expected_close_date,
    o.service_type,
    o.notes,
    o.cornerstone_matter_id,
    o.twenty_opportunity_id,
    o.created_at,
    o.updated_at,
    o.client_intake_id,
    o.status,
    o.owner_user_id,
    o.assigned_to_user_id,
    o.next_follow_up_at,
    o.lead_source,
    o.practice_area,
    o.close_reason,
    o.closed_at,
    o.stage_entered_at,
    o.source_system,
    o.updated_by_user_id,
    p.person_kind,
    vp.name AS person_name,
    vp.email AS person_email,
    vp.phone AS person_phone,
    s.name AS stage_name,
    s.slug AS stage_slug,
    m.matter_number,
    m.relationship_status AS workspace_relationship_status,
    m.status AS workspace_status
   FROM ((((public.cornerstone_crm_opportunities o
     JOIN public.cornerstone_crm_people p ON ((p.id = o.person_id)))
     JOIN public.v_cornerstone_crm_people vp ON ((vp.id = p.id)))
     JOIN public.cornerstone_crm_stages s ON ((s.id = o.stage_id)))
     LEFT JOIN public.matters m ON ((m.id = o.cornerstone_matter_id)));


grant delete on table "public"."ai_usage" to "anon";

grant insert on table "public"."ai_usage" to "anon";

grant select on table "public"."ai_usage" to "anon";

grant update on table "public"."ai_usage" to "anon";

grant delete on table "public"."ai_usage" to "authenticated";

grant insert on table "public"."ai_usage" to "authenticated";

grant select on table "public"."ai_usage" to "authenticated";

grant update on table "public"."ai_usage" to "authenticated";

grant delete on table "public"."ai_usage" to "service_role";

grant insert on table "public"."ai_usage" to "service_role";

grant select on table "public"."ai_usage" to "service_role";

grant update on table "public"."ai_usage" to "service_role";

grant delete on table "public"."appointment_types" to "anon";

grant insert on table "public"."appointment_types" to "anon";

grant select on table "public"."appointment_types" to "anon";

grant update on table "public"."appointment_types" to "anon";

grant delete on table "public"."appointment_types" to "authenticated";

grant insert on table "public"."appointment_types" to "authenticated";

grant select on table "public"."appointment_types" to "authenticated";

grant update on table "public"."appointment_types" to "authenticated";

grant delete on table "public"."appointment_types" to "service_role";

grant insert on table "public"."appointment_types" to "service_role";

grant select on table "public"."appointment_types" to "service_role";

grant update on table "public"."appointment_types" to "service_role";

grant delete on table "public"."appointments" to "anon";

grant insert on table "public"."appointments" to "anon";

grant select on table "public"."appointments" to "anon";

grant update on table "public"."appointments" to "anon";

grant delete on table "public"."appointments" to "authenticated";

grant insert on table "public"."appointments" to "authenticated";

grant select on table "public"."appointments" to "authenticated";

grant update on table "public"."appointments" to "authenticated";

grant delete on table "public"."appointments" to "service_role";

grant insert on table "public"."appointments" to "service_role";

grant select on table "public"."appointments" to "service_role";

grant update on table "public"."appointments" to "service_role";

grant delete on table "public"."asset_intake" to "anon";

grant insert on table "public"."asset_intake" to "anon";

grant select on table "public"."asset_intake" to "anon";

grant update on table "public"."asset_intake" to "anon";

grant delete on table "public"."asset_intake" to "authenticated";

grant insert on table "public"."asset_intake" to "authenticated";

grant select on table "public"."asset_intake" to "authenticated";

grant update on table "public"."asset_intake" to "authenticated";

grant delete on table "public"."asset_intake" to "service_role";

grant insert on table "public"."asset_intake" to "service_role";

grant select on table "public"."asset_intake" to "service_role";

grant update on table "public"."asset_intake" to "service_role";

grant delete on table "public"."assistant_chat_messages" to "anon";

grant insert on table "public"."assistant_chat_messages" to "anon";

grant select on table "public"."assistant_chat_messages" to "anon";

grant update on table "public"."assistant_chat_messages" to "anon";

grant delete on table "public"."assistant_chat_messages" to "service_role";

grant insert on table "public"."assistant_chat_messages" to "service_role";

grant select on table "public"."assistant_chat_messages" to "service_role";

grant update on table "public"."assistant_chat_messages" to "service_role";

grant delete on table "public"."assistant_chats" to "anon";

grant insert on table "public"."assistant_chats" to "anon";

grant select on table "public"."assistant_chats" to "anon";

grant update on table "public"."assistant_chats" to "anon";

grant delete on table "public"."assistant_chats" to "service_role";

grant insert on table "public"."assistant_chats" to "service_role";

grant select on table "public"."assistant_chats" to "service_role";

grant update on table "public"."assistant_chats" to "service_role";

grant delete on table "public"."billing_events" to "anon";

grant insert on table "public"."billing_events" to "anon";

grant select on table "public"."billing_events" to "anon";

grant update on table "public"."billing_events" to "anon";

grant delete on table "public"."billing_events" to "service_role";

grant insert on table "public"."billing_events" to "service_role";

grant select on table "public"."billing_events" to "service_role";

grant update on table "public"."billing_events" to "service_role";

grant delete on table "public"."billing_items" to "anon";

grant insert on table "public"."billing_items" to "anon";

grant select on table "public"."billing_items" to "anon";

grant update on table "public"."billing_items" to "anon";

grant delete on table "public"."billing_items" to "service_role";

grant insert on table "public"."billing_items" to "service_role";

grant select on table "public"."billing_items" to "service_role";

grant update on table "public"."billing_items" to "service_role";

grant delete on table "public"."billing_nudge_dismissals" to "anon";

grant insert on table "public"."billing_nudge_dismissals" to "anon";

grant select on table "public"."billing_nudge_dismissals" to "anon";

grant update on table "public"."billing_nudge_dismissals" to "anon";

grant update on table "public"."billing_nudge_dismissals" to "authenticated";

grant delete on table "public"."billing_nudge_dismissals" to "service_role";

grant insert on table "public"."billing_nudge_dismissals" to "service_role";

grant select on table "public"."billing_nudge_dismissals" to "service_role";

grant update on table "public"."billing_nudge_dismissals" to "service_role";

grant delete on table "public"."billing_payments" to "anon";

grant insert on table "public"."billing_payments" to "anon";

grant select on table "public"."billing_payments" to "anon";

grant update on table "public"."billing_payments" to "anon";

grant delete on table "public"."billing_payments" to "service_role";

grant insert on table "public"."billing_payments" to "service_role";

grant select on table "public"."billing_payments" to "service_role";

grant update on table "public"."billing_payments" to "service_role";

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

grant delete on table "public"."calendar_attention_dismissals" to "anon";

grant insert on table "public"."calendar_attention_dismissals" to "anon";

grant select on table "public"."calendar_attention_dismissals" to "anon";

grant update on table "public"."calendar_attention_dismissals" to "anon";

grant update on table "public"."calendar_attention_dismissals" to "authenticated";

grant delete on table "public"."calendar_attention_dismissals" to "service_role";

grant insert on table "public"."calendar_attention_dismissals" to "service_role";

grant select on table "public"."calendar_attention_dismissals" to "service_role";

grant update on table "public"."calendar_attention_dismissals" to "service_role";

grant delete on table "public"."calendar_connections" to "anon";

grant insert on table "public"."calendar_connections" to "anon";

grant select on table "public"."calendar_connections" to "anon";

grant update on table "public"."calendar_connections" to "anon";

grant delete on table "public"."calendar_connections" to "authenticated";

grant insert on table "public"."calendar_connections" to "authenticated";

grant select on table "public"."calendar_connections" to "authenticated";

grant update on table "public"."calendar_connections" to "authenticated";

grant delete on table "public"."calendar_connections" to "service_role";

grant insert on table "public"."calendar_connections" to "service_role";

grant select on table "public"."calendar_connections" to "service_role";

grant update on table "public"."calendar_connections" to "service_role";

grant delete on table "public"."calls" to "anon";

grant insert on table "public"."calls" to "anon";

grant select on table "public"."calls" to "anon";

grant update on table "public"."calls" to "anon";

grant delete on table "public"."calls" to "authenticated";

grant insert on table "public"."calls" to "authenticated";

grant select on table "public"."calls" to "authenticated";

grant update on table "public"."calls" to "authenticated";

grant delete on table "public"."calls" to "service_role";

grant insert on table "public"."calls" to "service_role";

grant select on table "public"."calls" to "service_role";

grant update on table "public"."calls" to "service_role";

grant delete on table "public"."client_intake" to "anon";

grant insert on table "public"."client_intake" to "anon";

grant select on table "public"."client_intake" to "anon";

grant update on table "public"."client_intake" to "anon";

grant delete on table "public"."client_intake" to "authenticated";

grant insert on table "public"."client_intake" to "authenticated";

grant select on table "public"."client_intake" to "authenticated";

grant update on table "public"."client_intake" to "authenticated";

grant delete on table "public"."client_intake" to "service_role";

grant insert on table "public"."client_intake" to "service_role";

grant select on table "public"."client_intake" to "service_role";

grant update on table "public"."client_intake" to "service_role";

grant delete on table "public"."communication_thread_state" to "anon";

grant insert on table "public"."communication_thread_state" to "anon";

grant select on table "public"."communication_thread_state" to "anon";

grant update on table "public"."communication_thread_state" to "anon";

grant delete on table "public"."communication_thread_state" to "authenticated";

grant insert on table "public"."communication_thread_state" to "authenticated";

grant select on table "public"."communication_thread_state" to "authenticated";

grant update on table "public"."communication_thread_state" to "authenticated";

grant delete on table "public"."communication_thread_state" to "service_role";

grant insert on table "public"."communication_thread_state" to "service_role";

grant select on table "public"."communication_thread_state" to "service_role";

grant update on table "public"."communication_thread_state" to "service_role";

grant delete on table "public"."contact_roles" to "anon";

grant insert on table "public"."contact_roles" to "anon";

grant select on table "public"."contact_roles" to "anon";

grant update on table "public"."contact_roles" to "anon";

grant delete on table "public"."contact_roles" to "authenticated";

grant insert on table "public"."contact_roles" to "authenticated";

grant select on table "public"."contact_roles" to "authenticated";

grant update on table "public"."contact_roles" to "authenticated";

grant delete on table "public"."contact_roles" to "service_role";

grant insert on table "public"."contact_roles" to "service_role";

grant select on table "public"."contact_roles" to "service_role";

grant update on table "public"."contact_roles" to "service_role";

grant delete on table "public"."contacts" to "anon";

grant insert on table "public"."contacts" to "anon";

grant select on table "public"."contacts" to "anon";

grant update on table "public"."contacts" to "anon";

grant delete on table "public"."contacts" to "authenticated";

grant insert on table "public"."contacts" to "authenticated";

grant select on table "public"."contacts" to "authenticated";

grant update on table "public"."contacts" to "authenticated";

grant delete on table "public"."contacts" to "service_role";

grant insert on table "public"."contacts" to "service_role";

grant select on table "public"."contacts" to "service_role";

grant update on table "public"."contacts" to "service_role";

grant delete on table "public"."cornerstone_crm_activities" to "anon";

grant insert on table "public"."cornerstone_crm_activities" to "anon";

grant select on table "public"."cornerstone_crm_activities" to "anon";

grant update on table "public"."cornerstone_crm_activities" to "anon";

grant delete on table "public"."cornerstone_crm_activities" to "service_role";

grant insert on table "public"."cornerstone_crm_activities" to "service_role";

grant select on table "public"."cornerstone_crm_activities" to "service_role";

grant update on table "public"."cornerstone_crm_activities" to "service_role";

grant delete on table "public"."cornerstone_crm_campaign_deliveries" to "anon";

grant insert on table "public"."cornerstone_crm_campaign_deliveries" to "anon";

grant select on table "public"."cornerstone_crm_campaign_deliveries" to "anon";

grant update on table "public"."cornerstone_crm_campaign_deliveries" to "anon";

grant delete on table "public"."cornerstone_crm_campaign_deliveries" to "authenticated";

grant insert on table "public"."cornerstone_crm_campaign_deliveries" to "authenticated";

grant select on table "public"."cornerstone_crm_campaign_deliveries" to "authenticated";

grant update on table "public"."cornerstone_crm_campaign_deliveries" to "authenticated";

grant delete on table "public"."cornerstone_crm_campaign_deliveries" to "service_role";

grant insert on table "public"."cornerstone_crm_campaign_deliveries" to "service_role";

grant select on table "public"."cornerstone_crm_campaign_deliveries" to "service_role";

grant update on table "public"."cornerstone_crm_campaign_deliveries" to "service_role";

grant delete on table "public"."cornerstone_crm_campaign_dispatches" to "anon";

grant insert on table "public"."cornerstone_crm_campaign_dispatches" to "anon";

grant select on table "public"."cornerstone_crm_campaign_dispatches" to "anon";

grant update on table "public"."cornerstone_crm_campaign_dispatches" to "anon";

grant delete on table "public"."cornerstone_crm_campaign_dispatches" to "authenticated";

grant insert on table "public"."cornerstone_crm_campaign_dispatches" to "authenticated";

grant select on table "public"."cornerstone_crm_campaign_dispatches" to "authenticated";

grant update on table "public"."cornerstone_crm_campaign_dispatches" to "authenticated";

grant delete on table "public"."cornerstone_crm_campaign_dispatches" to "service_role";

grant insert on table "public"."cornerstone_crm_campaign_dispatches" to "service_role";

grant select on table "public"."cornerstone_crm_campaign_dispatches" to "service_role";

grant update on table "public"."cornerstone_crm_campaign_dispatches" to "service_role";

grant delete on table "public"."cornerstone_crm_campaign_events" to "anon";

grant insert on table "public"."cornerstone_crm_campaign_events" to "anon";

grant select on table "public"."cornerstone_crm_campaign_events" to "anon";

grant update on table "public"."cornerstone_crm_campaign_events" to "anon";

grant delete on table "public"."cornerstone_crm_campaign_events" to "authenticated";

grant insert on table "public"."cornerstone_crm_campaign_events" to "authenticated";

grant select on table "public"."cornerstone_crm_campaign_events" to "authenticated";

grant update on table "public"."cornerstone_crm_campaign_events" to "authenticated";

grant delete on table "public"."cornerstone_crm_campaign_events" to "service_role";

grant insert on table "public"."cornerstone_crm_campaign_events" to "service_role";

grant select on table "public"."cornerstone_crm_campaign_events" to "service_role";

grant update on table "public"."cornerstone_crm_campaign_events" to "service_role";

grant delete on table "public"."cornerstone_crm_campaign_recipients" to "anon";

grant insert on table "public"."cornerstone_crm_campaign_recipients" to "anon";

grant select on table "public"."cornerstone_crm_campaign_recipients" to "anon";

grant update on table "public"."cornerstone_crm_campaign_recipients" to "anon";

grant delete on table "public"."cornerstone_crm_campaign_recipients" to "authenticated";

grant insert on table "public"."cornerstone_crm_campaign_recipients" to "authenticated";

grant select on table "public"."cornerstone_crm_campaign_recipients" to "authenticated";

grant update on table "public"."cornerstone_crm_campaign_recipients" to "authenticated";

grant delete on table "public"."cornerstone_crm_campaign_recipients" to "service_role";

grant insert on table "public"."cornerstone_crm_campaign_recipients" to "service_role";

grant select on table "public"."cornerstone_crm_campaign_recipients" to "service_role";

grant update on table "public"."cornerstone_crm_campaign_recipients" to "service_role";

grant delete on table "public"."cornerstone_crm_campaign_steps" to "anon";

grant insert on table "public"."cornerstone_crm_campaign_steps" to "anon";

grant select on table "public"."cornerstone_crm_campaign_steps" to "anon";

grant update on table "public"."cornerstone_crm_campaign_steps" to "anon";

grant delete on table "public"."cornerstone_crm_campaign_steps" to "service_role";

grant insert on table "public"."cornerstone_crm_campaign_steps" to "service_role";

grant select on table "public"."cornerstone_crm_campaign_steps" to "service_role";

grant update on table "public"."cornerstone_crm_campaign_steps" to "service_role";

grant delete on table "public"."cornerstone_crm_campaigns" to "anon";

grant insert on table "public"."cornerstone_crm_campaigns" to "anon";

grant select on table "public"."cornerstone_crm_campaigns" to "anon";

grant update on table "public"."cornerstone_crm_campaigns" to "anon";

grant delete on table "public"."cornerstone_crm_campaigns" to "authenticated";

grant insert on table "public"."cornerstone_crm_campaigns" to "authenticated";

grant select on table "public"."cornerstone_crm_campaigns" to "authenticated";

grant update on table "public"."cornerstone_crm_campaigns" to "authenticated";

grant delete on table "public"."cornerstone_crm_campaigns" to "service_role";

grant insert on table "public"."cornerstone_crm_campaigns" to "service_role";

grant select on table "public"."cornerstone_crm_campaigns" to "service_role";

grant update on table "public"."cornerstone_crm_campaigns" to "service_role";

grant delete on table "public"."cornerstone_crm_opportunities" to "anon";

grant insert on table "public"."cornerstone_crm_opportunities" to "anon";

grant select on table "public"."cornerstone_crm_opportunities" to "anon";

grant update on table "public"."cornerstone_crm_opportunities" to "anon";

grant delete on table "public"."cornerstone_crm_opportunities" to "service_role";

grant insert on table "public"."cornerstone_crm_opportunities" to "service_role";

grant select on table "public"."cornerstone_crm_opportunities" to "service_role";

grant update on table "public"."cornerstone_crm_opportunities" to "service_role";

grant delete on table "public"."cornerstone_crm_people" to "anon";

grant insert on table "public"."cornerstone_crm_people" to "anon";

grant select on table "public"."cornerstone_crm_people" to "anon";

grant update on table "public"."cornerstone_crm_people" to "anon";

grant delete on table "public"."cornerstone_crm_people" to "service_role";

grant insert on table "public"."cornerstone_crm_people" to "service_role";

grant select on table "public"."cornerstone_crm_people" to "service_role";

grant update on table "public"."cornerstone_crm_people" to "service_role";

grant delete on table "public"."cornerstone_crm_settings" to "anon";

grant insert on table "public"."cornerstone_crm_settings" to "anon";

grant select on table "public"."cornerstone_crm_settings" to "anon";

grant update on table "public"."cornerstone_crm_settings" to "anon";

grant delete on table "public"."cornerstone_crm_settings" to "authenticated";

grant insert on table "public"."cornerstone_crm_settings" to "authenticated";

grant select on table "public"."cornerstone_crm_settings" to "authenticated";

grant update on table "public"."cornerstone_crm_settings" to "authenticated";

grant delete on table "public"."cornerstone_crm_settings" to "service_role";

grant insert on table "public"."cornerstone_crm_settings" to "service_role";

grant select on table "public"."cornerstone_crm_settings" to "service_role";

grant update on table "public"."cornerstone_crm_settings" to "service_role";

grant delete on table "public"."cornerstone_crm_stages" to "anon";

grant insert on table "public"."cornerstone_crm_stages" to "anon";

grant select on table "public"."cornerstone_crm_stages" to "anon";

grant update on table "public"."cornerstone_crm_stages" to "anon";

grant delete on table "public"."cornerstone_crm_stages" to "authenticated";

grant insert on table "public"."cornerstone_crm_stages" to "authenticated";

grant select on table "public"."cornerstone_crm_stages" to "authenticated";

grant update on table "public"."cornerstone_crm_stages" to "authenticated";

grant delete on table "public"."cornerstone_crm_stages" to "service_role";

grant insert on table "public"."cornerstone_crm_stages" to "service_role";

grant select on table "public"."cornerstone_crm_stages" to "service_role";

grant update on table "public"."cornerstone_crm_stages" to "service_role";

grant delete on table "public"."cornerstone_crm_sync_events" to "anon";

grant insert on table "public"."cornerstone_crm_sync_events" to "anon";

grant select on table "public"."cornerstone_crm_sync_events" to "anon";

grant update on table "public"."cornerstone_crm_sync_events" to "anon";

grant delete on table "public"."cornerstone_crm_sync_events" to "authenticated";

grant insert on table "public"."cornerstone_crm_sync_events" to "authenticated";

grant update on table "public"."cornerstone_crm_sync_events" to "authenticated";

grant delete on table "public"."cornerstone_crm_sync_events" to "service_role";

grant insert on table "public"."cornerstone_crm_sync_events" to "service_role";

grant select on table "public"."cornerstone_crm_sync_events" to "service_role";

grant update on table "public"."cornerstone_crm_sync_events" to "service_role";

grant delete on table "public"."custom_document_templates" to "anon";

grant insert on table "public"."custom_document_templates" to "anon";

grant select on table "public"."custom_document_templates" to "anon";

grant update on table "public"."custom_document_templates" to "anon";

grant delete on table "public"."custom_document_templates" to "authenticated";

grant insert on table "public"."custom_document_templates" to "authenticated";

grant select on table "public"."custom_document_templates" to "authenticated";

grant update on table "public"."custom_document_templates" to "authenticated";

grant delete on table "public"."custom_document_templates" to "service_role";

grant insert on table "public"."custom_document_templates" to "service_role";

grant select on table "public"."custom_document_templates" to "service_role";

grant update on table "public"."custom_document_templates" to "service_role";

grant delete on table "public"."design_sheets" to "anon";

grant insert on table "public"."design_sheets" to "anon";

grant select on table "public"."design_sheets" to "anon";

grant update on table "public"."design_sheets" to "anon";

grant delete on table "public"."design_sheets" to "authenticated";

grant insert on table "public"."design_sheets" to "authenticated";

grant select on table "public"."design_sheets" to "authenticated";

grant update on table "public"."design_sheets" to "authenticated";

grant delete on table "public"."design_sheets" to "service_role";

grant insert on table "public"."design_sheets" to "service_role";

grant select on table "public"."design_sheets" to "service_role";

grant update on table "public"."design_sheets" to "service_role";

grant delete on table "public"."doc_selections" to "anon";

grant insert on table "public"."doc_selections" to "anon";

grant select on table "public"."doc_selections" to "anon";

grant update on table "public"."doc_selections" to "anon";

grant delete on table "public"."doc_selections" to "authenticated";

grant insert on table "public"."doc_selections" to "authenticated";

grant select on table "public"."doc_selections" to "authenticated";

grant update on table "public"."doc_selections" to "authenticated";

grant delete on table "public"."doc_selections" to "service_role";

grant insert on table "public"."doc_selections" to "service_role";

grant select on table "public"."doc_selections" to "service_role";

grant update on table "public"."doc_selections" to "service_role";

grant delete on table "public"."document_access_audit" to "anon";

grant insert on table "public"."document_access_audit" to "anon";

grant select on table "public"."document_access_audit" to "anon";

grant update on table "public"."document_access_audit" to "anon";

grant delete on table "public"."document_access_audit" to "authenticated";

grant insert on table "public"."document_access_audit" to "authenticated";

grant select on table "public"."document_access_audit" to "authenticated";

grant update on table "public"."document_access_audit" to "authenticated";

grant delete on table "public"."document_access_audit" to "service_role";

grant insert on table "public"."document_access_audit" to "service_role";

grant select on table "public"."document_access_audit" to "service_role";

grant update on table "public"."document_access_audit" to "service_role";

grant delete on table "public"."document_edits" to "anon";

grant insert on table "public"."document_edits" to "anon";

grant select on table "public"."document_edits" to "anon";

grant update on table "public"."document_edits" to "anon";

grant delete on table "public"."document_edits" to "authenticated";

grant insert on table "public"."document_edits" to "authenticated";

grant select on table "public"."document_edits" to "authenticated";

grant update on table "public"."document_edits" to "authenticated";

grant delete on table "public"."document_edits" to "service_role";

grant insert on table "public"."document_edits" to "service_role";

grant select on table "public"."document_edits" to "service_role";

grant update on table "public"."document_edits" to "service_role";

grant delete on table "public"."document_template_events" to "service_role";

grant insert on table "public"."document_template_events" to "service_role";

grant select on table "public"."document_template_events" to "service_role";

grant update on table "public"."document_template_events" to "service_role";

grant delete on table "public"."document_template_publications" to "service_role";

grant insert on table "public"."document_template_publications" to "service_role";

grant select on table "public"."document_template_publications" to "service_role";

grant update on table "public"."document_template_publications" to "service_role";

grant delete on table "public"."document_template_versions" to "service_role";

grant insert on table "public"."document_template_versions" to "service_role";

grant select on table "public"."document_template_versions" to "service_role";

grant update on table "public"."document_template_versions" to "service_role";

grant delete on table "public"."document_versions" to "anon";

grant insert on table "public"."document_versions" to "anon";

grant select on table "public"."document_versions" to "anon";

grant update on table "public"."document_versions" to "anon";

grant delete on table "public"."document_versions" to "authenticated";

grant insert on table "public"."document_versions" to "authenticated";

grant select on table "public"."document_versions" to "authenticated";

grant update on table "public"."document_versions" to "authenticated";

grant delete on table "public"."document_versions" to "service_role";

grant insert on table "public"."document_versions" to "service_role";

grant select on table "public"."document_versions" to "service_role";

grant update on table "public"."document_versions" to "service_role";

grant delete on table "public"."draft_log" to "anon";

grant insert on table "public"."draft_log" to "anon";

grant select on table "public"."draft_log" to "anon";

grant update on table "public"."draft_log" to "anon";

grant delete on table "public"."draft_log" to "authenticated";

grant insert on table "public"."draft_log" to "authenticated";

grant select on table "public"."draft_log" to "authenticated";

grant update on table "public"."draft_log" to "authenticated";

grant delete on table "public"."draft_log" to "service_role";

grant insert on table "public"."draft_log" to "service_role";

grant select on table "public"."draft_log" to "service_role";

grant update on table "public"."draft_log" to "service_role";

grant delete on table "public"."email_drafts" to "anon";

grant insert on table "public"."email_drafts" to "anon";

grant select on table "public"."email_drafts" to "anon";

grant update on table "public"."email_drafts" to "anon";

grant delete on table "public"."email_log" to "anon";

grant insert on table "public"."email_log" to "anon";

grant select on table "public"."email_log" to "anon";

grant update on table "public"."email_log" to "anon";

grant delete on table "public"."email_log" to "authenticated";

grant insert on table "public"."email_log" to "authenticated";

grant select on table "public"."email_log" to "authenticated";

grant update on table "public"."email_log" to "authenticated";

grant delete on table "public"."email_log" to "service_role";

grant insert on table "public"."email_log" to "service_role";

grant select on table "public"."email_log" to "service_role";

grant update on table "public"."email_log" to "service_role";

grant delete on table "public"."email_settings" to "anon";

grant insert on table "public"."email_settings" to "anon";

grant select on table "public"."email_settings" to "anon";

grant update on table "public"."email_settings" to "anon";

grant delete on table "public"."email_settings" to "authenticated";

grant insert on table "public"."email_settings" to "authenticated";

grant select on table "public"."email_settings" to "authenticated";

grant update on table "public"."email_settings" to "authenticated";

grant delete on table "public"."email_settings" to "service_role";

grant insert on table "public"."email_settings" to "service_role";

grant select on table "public"."email_settings" to "service_role";

grant update on table "public"."email_settings" to "service_role";

grant delete on table "public"."email_templates" to "anon";

grant insert on table "public"."email_templates" to "anon";

grant select on table "public"."email_templates" to "anon";

grant update on table "public"."email_templates" to "anon";

grant delete on table "public"."email_templates" to "authenticated";

grant insert on table "public"."email_templates" to "authenticated";

grant select on table "public"."email_templates" to "authenticated";

grant update on table "public"."email_templates" to "authenticated";

grant delete on table "public"."email_templates" to "service_role";

grant insert on table "public"."email_templates" to "service_role";

grant select on table "public"."email_templates" to "service_role";

grant update on table "public"."email_templates" to "service_role";

grant delete on table "public"."engagement_agreement_recipients" to "anon";

grant insert on table "public"."engagement_agreement_recipients" to "anon";

grant select on table "public"."engagement_agreement_recipients" to "anon";

grant update on table "public"."engagement_agreement_recipients" to "anon";

grant delete on table "public"."engagement_agreement_recipients" to "authenticated";

grant insert on table "public"."engagement_agreement_recipients" to "authenticated";

grant select on table "public"."engagement_agreement_recipients" to "authenticated";

grant update on table "public"."engagement_agreement_recipients" to "authenticated";

grant delete on table "public"."engagement_agreement_recipients" to "service_role";

grant insert on table "public"."engagement_agreement_recipients" to "service_role";

grant select on table "public"."engagement_agreement_recipients" to "service_role";

grant update on table "public"."engagement_agreement_recipients" to "service_role";

grant delete on table "public"."engagement_agreement_revisions" to "anon";

grant insert on table "public"."engagement_agreement_revisions" to "anon";

grant select on table "public"."engagement_agreement_revisions" to "anon";

grant update on table "public"."engagement_agreement_revisions" to "anon";

grant delete on table "public"."engagement_agreement_revisions" to "authenticated";

grant insert on table "public"."engagement_agreement_revisions" to "authenticated";

grant select on table "public"."engagement_agreement_revisions" to "authenticated";

grant update on table "public"."engagement_agreement_revisions" to "authenticated";

grant delete on table "public"."engagement_agreement_revisions" to "service_role";

grant insert on table "public"."engagement_agreement_revisions" to "service_role";

grant select on table "public"."engagement_agreement_revisions" to "service_role";

grant update on table "public"."engagement_agreement_revisions" to "service_role";

grant delete on table "public"."engagement_agreements" to "anon";

grant insert on table "public"."engagement_agreements" to "anon";

grant select on table "public"."engagement_agreements" to "anon";

grant update on table "public"."engagement_agreements" to "anon";

grant delete on table "public"."engagement_agreements" to "authenticated";

grant insert on table "public"."engagement_agreements" to "authenticated";

grant select on table "public"."engagement_agreements" to "authenticated";

grant update on table "public"."engagement_agreements" to "authenticated";

grant delete on table "public"."engagement_agreements" to "service_role";

grant insert on table "public"."engagement_agreements" to "service_role";

grant select on table "public"."engagement_agreements" to "service_role";

grant update on table "public"."engagement_agreements" to "service_role";

grant delete on table "public"."engagement_clause_library" to "anon";

grant insert on table "public"."engagement_clause_library" to "anon";

grant select on table "public"."engagement_clause_library" to "anon";

grant update on table "public"."engagement_clause_library" to "anon";

grant delete on table "public"."engagement_clause_library" to "service_role";

grant insert on table "public"."engagement_clause_library" to "service_role";

grant select on table "public"."engagement_clause_library" to "service_role";

grant update on table "public"."engagement_clause_library" to "service_role";

grant delete on table "public"."external_bookings" to "anon";

grant insert on table "public"."external_bookings" to "anon";

grant select on table "public"."external_bookings" to "anon";

grant update on table "public"."external_bookings" to "anon";

grant delete on table "public"."external_bookings" to "authenticated";

grant insert on table "public"."external_bookings" to "authenticated";

grant select on table "public"."external_bookings" to "authenticated";

grant update on table "public"."external_bookings" to "authenticated";

grant delete on table "public"."external_bookings" to "service_role";

grant insert on table "public"."external_bookings" to "service_role";

grant select on table "public"."external_bookings" to "service_role";

grant update on table "public"."external_bookings" to "service_role";

grant delete on table "public"."firm_settings" to "anon";

grant insert on table "public"."firm_settings" to "anon";

grant select on table "public"."firm_settings" to "anon";

grant update on table "public"."firm_settings" to "anon";

grant delete on table "public"."firm_settings" to "authenticated";

grant insert on table "public"."firm_settings" to "authenticated";

grant select on table "public"."firm_settings" to "authenticated";

grant update on table "public"."firm_settings" to "authenticated";

grant delete on table "public"."firm_settings" to "service_role";

grant insert on table "public"."firm_settings" to "service_role";

grant select on table "public"."firm_settings" to "service_role";

grant update on table "public"."firm_settings" to "service_role";

grant delete on table "public"."firma_webhook_events" to "anon";

grant insert on table "public"."firma_webhook_events" to "anon";

grant select on table "public"."firma_webhook_events" to "anon";

grant update on table "public"."firma_webhook_events" to "anon";

grant delete on table "public"."firma_webhook_events" to "authenticated";

grant insert on table "public"."firma_webhook_events" to "authenticated";

grant select on table "public"."firma_webhook_events" to "authenticated";

grant update on table "public"."firma_webhook_events" to "authenticated";

grant delete on table "public"."firma_webhook_events" to "service_role";

grant insert on table "public"."firma_webhook_events" to "service_role";

grant select on table "public"."firma_webhook_events" to "service_role";

grant update on table "public"."firma_webhook_events" to "service_role";

grant delete on table "public"."intake_documents" to "anon";

grant insert on table "public"."intake_documents" to "anon";

grant select on table "public"."intake_documents" to "anon";

grant update on table "public"."intake_documents" to "anon";

grant delete on table "public"."intake_documents" to "authenticated";

grant insert on table "public"."intake_documents" to "authenticated";

grant select on table "public"."intake_documents" to "authenticated";

grant update on table "public"."intake_documents" to "authenticated";

grant delete on table "public"."intake_documents" to "service_role";

grant insert on table "public"."intake_documents" to "service_role";

grant select on table "public"."intake_documents" to "service_role";

grant update on table "public"."intake_documents" to "service_role";

grant delete on table "public"."lawmatics_tokens" to "anon";

grant insert on table "public"."lawmatics_tokens" to "anon";

grant select on table "public"."lawmatics_tokens" to "anon";

grant update on table "public"."lawmatics_tokens" to "anon";

grant delete on table "public"."lawmatics_tokens" to "authenticated";

grant insert on table "public"."lawmatics_tokens" to "authenticated";

grant select on table "public"."lawmatics_tokens" to "authenticated";

grant update on table "public"."lawmatics_tokens" to "authenticated";

grant delete on table "public"."lawmatics_tokens" to "service_role";

grant insert on table "public"."lawmatics_tokens" to "service_role";

grant select on table "public"."lawmatics_tokens" to "service_role";

grant update on table "public"."lawmatics_tokens" to "service_role";

grant delete on table "public"."lead_activity" to "anon";

grant insert on table "public"."lead_activity" to "anon";

grant select on table "public"."lead_activity" to "anon";

grant update on table "public"."lead_activity" to "anon";

grant update on table "public"."lead_activity" to "authenticated";

grant delete on table "public"."lead_activity" to "service_role";

grant insert on table "public"."lead_activity" to "service_role";

grant select on table "public"."lead_activity" to "service_role";

grant update on table "public"."lead_activity" to "service_role";

grant delete on table "public"."lead_meeting_notes" to "anon";

grant insert on table "public"."lead_meeting_notes" to "anon";

grant select on table "public"."lead_meeting_notes" to "anon";

grant update on table "public"."lead_meeting_notes" to "anon";

grant delete on table "public"."lead_meeting_notes" to "service_role";

grant insert on table "public"."lead_meeting_notes" to "service_role";

grant select on table "public"."lead_meeting_notes" to "service_role";

grant update on table "public"."lead_meeting_notes" to "service_role";

grant delete on table "public"."lead_notes" to "anon";

grant insert on table "public"."lead_notes" to "anon";

grant select on table "public"."lead_notes" to "anon";

grant update on table "public"."lead_notes" to "anon";

grant delete on table "public"."lead_notes" to "service_role";

grant insert on table "public"."lead_notes" to "service_role";

grant select on table "public"."lead_notes" to "service_role";

grant update on table "public"."lead_notes" to "service_role";

grant delete on table "public"."matter_activity" to "anon";

grant insert on table "public"."matter_activity" to "anon";

grant select on table "public"."matter_activity" to "anon";

grant update on table "public"."matter_activity" to "anon";

grant delete on table "public"."matter_activity" to "authenticated";

grant insert on table "public"."matter_activity" to "authenticated";

grant select on table "public"."matter_activity" to "authenticated";

grant update on table "public"."matter_activity" to "authenticated";

grant delete on table "public"."matter_activity" to "service_role";

grant insert on table "public"."matter_activity" to "service_role";

grant select on table "public"."matter_activity" to "service_role";

grant update on table "public"."matter_activity" to "service_role";

grant delete on table "public"."matter_assistant_messages" to "anon";

grant insert on table "public"."matter_assistant_messages" to "anon";

grant select on table "public"."matter_assistant_messages" to "anon";

grant update on table "public"."matter_assistant_messages" to "anon";

grant delete on table "public"."matter_assistant_messages" to "authenticated";

grant insert on table "public"."matter_assistant_messages" to "authenticated";

grant select on table "public"."matter_assistant_messages" to "authenticated";

grant update on table "public"."matter_assistant_messages" to "authenticated";

grant delete on table "public"."matter_assistant_messages" to "service_role";

grant insert on table "public"."matter_assistant_messages" to "service_role";

grant select on table "public"."matter_assistant_messages" to "service_role";

grant update on table "public"."matter_assistant_messages" to "service_role";

grant delete on table "public"."matter_details" to "anon";

grant insert on table "public"."matter_details" to "anon";

grant select on table "public"."matter_details" to "anon";

grant update on table "public"."matter_details" to "anon";

grant delete on table "public"."matter_details" to "authenticated";

grant insert on table "public"."matter_details" to "authenticated";

grant select on table "public"."matter_details" to "authenticated";

grant update on table "public"."matter_details" to "authenticated";

grant delete on table "public"."matter_details" to "service_role";

grant insert on table "public"."matter_details" to "service_role";

grant select on table "public"."matter_details" to "service_role";

grant update on table "public"."matter_details" to "service_role";

grant delete on table "public"."matter_documents" to "anon";

grant insert on table "public"."matter_documents" to "anon";

grant select on table "public"."matter_documents" to "anon";

grant update on table "public"."matter_documents" to "anon";

grant delete on table "public"."matter_documents" to "authenticated";

grant insert on table "public"."matter_documents" to "authenticated";

grant select on table "public"."matter_documents" to "authenticated";

grant update on table "public"."matter_documents" to "authenticated";

grant delete on table "public"."matter_documents" to "service_role";

grant insert on table "public"."matter_documents" to "service_role";

grant select on table "public"."matter_documents" to "service_role";

grant update on table "public"."matter_documents" to "service_role";

grant delete on table "public"."matter_notes" to "anon";

grant insert on table "public"."matter_notes" to "anon";

grant select on table "public"."matter_notes" to "anon";

grant update on table "public"."matter_notes" to "anon";

grant delete on table "public"."matter_notes" to "authenticated";

grant insert on table "public"."matter_notes" to "authenticated";

grant select on table "public"."matter_notes" to "authenticated";

grant update on table "public"."matter_notes" to "authenticated";

grant delete on table "public"."matter_notes" to "service_role";

grant insert on table "public"."matter_notes" to "service_role";

grant select on table "public"."matter_notes" to "service_role";

grant update on table "public"."matter_notes" to "service_role";

grant delete on table "public"."matter_relationship_status_history" to "anon";

grant insert on table "public"."matter_relationship_status_history" to "anon";

grant select on table "public"."matter_relationship_status_history" to "anon";

grant update on table "public"."matter_relationship_status_history" to "anon";

grant delete on table "public"."matter_relationship_status_history" to "authenticated";

grant insert on table "public"."matter_relationship_status_history" to "authenticated";

grant update on table "public"."matter_relationship_status_history" to "authenticated";

grant delete on table "public"."matter_relationship_status_history" to "service_role";

grant update on table "public"."matter_relationship_status_history" to "service_role";

grant delete on table "public"."matter_stage_rules" to "anon";

grant insert on table "public"."matter_stage_rules" to "anon";

grant select on table "public"."matter_stage_rules" to "anon";

grant update on table "public"."matter_stage_rules" to "anon";

grant delete on table "public"."matter_stage_rules" to "authenticated";

grant insert on table "public"."matter_stage_rules" to "authenticated";

grant select on table "public"."matter_stage_rules" to "authenticated";

grant update on table "public"."matter_stage_rules" to "authenticated";

grant delete on table "public"."matter_stage_rules" to "service_role";

grant insert on table "public"."matter_stage_rules" to "service_role";

grant select on table "public"."matter_stage_rules" to "service_role";

grant update on table "public"."matter_stage_rules" to "service_role";

grant delete on table "public"."matter_tasks" to "anon";

grant insert on table "public"."matter_tasks" to "anon";

grant select on table "public"."matter_tasks" to "anon";

grant update on table "public"."matter_tasks" to "anon";

grant delete on table "public"."matter_tasks" to "service_role";

grant insert on table "public"."matter_tasks" to "service_role";

grant select on table "public"."matter_tasks" to "service_role";

grant update on table "public"."matter_tasks" to "service_role";

grant delete on table "public"."matters" to "anon";

grant insert on table "public"."matters" to "anon";

grant select on table "public"."matters" to "anon";

grant update on table "public"."matters" to "anon";

grant delete on table "public"."matters" to "authenticated";

grant insert on table "public"."matters" to "authenticated";

grant select on table "public"."matters" to "authenticated";

grant update on table "public"."matters" to "authenticated";

grant delete on table "public"."matters" to "service_role";

grant insert on table "public"."matters" to "service_role";

grant select on table "public"."matters" to "service_role";

grant update on table "public"."matters" to "service_role";

grant delete on table "public"."messages" to "anon";

grant insert on table "public"."messages" to "anon";

grant select on table "public"."messages" to "anon";

grant update on table "public"."messages" to "anon";

grant delete on table "public"."messages" to "authenticated";

grant insert on table "public"."messages" to "authenticated";

grant select on table "public"."messages" to "authenticated";

grant update on table "public"."messages" to "authenticated";

grant delete on table "public"."messages" to "service_role";

grant insert on table "public"."messages" to "service_role";

grant select on table "public"."messages" to "service_role";

grant update on table "public"."messages" to "service_role";

grant delete on table "public"."pipeline_aging_snooze" to "anon";

grant insert on table "public"."pipeline_aging_snooze" to "anon";

grant select on table "public"."pipeline_aging_snooze" to "anon";

grant update on table "public"."pipeline_aging_snooze" to "anon";

grant delete on table "public"."pipeline_aging_snooze" to "authenticated";

grant insert on table "public"."pipeline_aging_snooze" to "authenticated";

grant select on table "public"."pipeline_aging_snooze" to "authenticated";

grant update on table "public"."pipeline_aging_snooze" to "authenticated";

grant delete on table "public"."rate_limits" to "anon";

grant insert on table "public"."rate_limits" to "anon";

grant select on table "public"."rate_limits" to "anon";

grant update on table "public"."rate_limits" to "anon";

grant delete on table "public"."rate_limits" to "authenticated";

grant insert on table "public"."rate_limits" to "authenticated";

grant select on table "public"."rate_limits" to "authenticated";

grant update on table "public"."rate_limits" to "authenticated";

grant delete on table "public"."rate_limits" to "service_role";

grant insert on table "public"."rate_limits" to "service_role";

grant select on table "public"."rate_limits" to "service_role";

grant update on table "public"."rate_limits" to "service_role";

grant delete on table "public"."scheduled_emails" to "anon";

grant insert on table "public"."scheduled_emails" to "anon";

grant select on table "public"."scheduled_emails" to "anon";

grant update on table "public"."scheduled_emails" to "anon";

grant delete on table "public"."scheduled_emails" to "authenticated";

grant delete on table "public"."scheduling_settings" to "anon";

grant insert on table "public"."scheduling_settings" to "anon";

grant select on table "public"."scheduling_settings" to "anon";

grant update on table "public"."scheduling_settings" to "anon";

grant delete on table "public"."scheduling_settings" to "authenticated";

grant insert on table "public"."scheduling_settings" to "authenticated";

grant select on table "public"."scheduling_settings" to "authenticated";

grant update on table "public"."scheduling_settings" to "authenticated";

grant delete on table "public"."scheduling_settings" to "service_role";

grant insert on table "public"."scheduling_settings" to "service_role";

grant select on table "public"."scheduling_settings" to "service_role";

grant update on table "public"."scheduling_settings" to "service_role";

grant delete on table "public"."sla_task_templates" to "anon";

grant insert on table "public"."sla_task_templates" to "anon";

grant select on table "public"."sla_task_templates" to "anon";

grant update on table "public"."sla_task_templates" to "anon";

grant delete on table "public"."sla_task_templates" to "service_role";

grant insert on table "public"."sla_task_templates" to "service_role";

grant select on table "public"."sla_task_templates" to "service_role";

grant update on table "public"."sla_task_templates" to "service_role";

grant delete on table "public"."sms_messages" to "anon";

grant insert on table "public"."sms_messages" to "anon";

grant select on table "public"."sms_messages" to "anon";

grant update on table "public"."sms_messages" to "anon";

grant delete on table "public"."sms_messages" to "authenticated";

grant insert on table "public"."sms_messages" to "authenticated";

grant select on table "public"."sms_messages" to "authenticated";

grant update on table "public"."sms_messages" to "authenticated";

grant delete on table "public"."sms_messages" to "service_role";

grant insert on table "public"."sms_messages" to "service_role";

grant select on table "public"."sms_messages" to "service_role";

grant update on table "public"."sms_messages" to "service_role";

grant delete on table "public"."stage_sla" to "anon";

grant insert on table "public"."stage_sla" to "anon";

grant select on table "public"."stage_sla" to "anon";

grant update on table "public"."stage_sla" to "anon";

grant delete on table "public"."stage_sla" to "authenticated";

grant insert on table "public"."stage_sla" to "authenticated";

grant select on table "public"."stage_sla" to "authenticated";

grant update on table "public"."stage_sla" to "authenticated";

grant delete on table "public"."stage_sla" to "service_role";

grant insert on table "public"."stage_sla" to "service_role";

grant update on table "public"."stage_sla" to "service_role";

grant delete on table "public"."stage_tasks" to "anon";

grant insert on table "public"."stage_tasks" to "anon";

grant select on table "public"."stage_tasks" to "anon";

grant update on table "public"."stage_tasks" to "anon";

grant delete on table "public"."stage_tasks" to "authenticated";

grant insert on table "public"."stage_tasks" to "authenticated";

grant select on table "public"."stage_tasks" to "authenticated";

grant update on table "public"."stage_tasks" to "authenticated";

grant delete on table "public"."stage_tasks" to "service_role";

grant insert on table "public"."stage_tasks" to "service_role";

grant select on table "public"."stage_tasks" to "service_role";

grant update on table "public"."stage_tasks" to "service_role";

grant delete on table "public"."tabular_cells" to "anon";

grant insert on table "public"."tabular_cells" to "anon";

grant select on table "public"."tabular_cells" to "anon";

grant update on table "public"."tabular_cells" to "anon";

grant delete on table "public"."tabular_cells" to "authenticated";

grant insert on table "public"."tabular_cells" to "authenticated";

grant select on table "public"."tabular_cells" to "authenticated";

grant update on table "public"."tabular_cells" to "authenticated";

grant delete on table "public"."tabular_cells" to "service_role";

grant insert on table "public"."tabular_cells" to "service_role";

grant select on table "public"."tabular_cells" to "service_role";

grant update on table "public"."tabular_cells" to "service_role";

grant delete on table "public"."tabular_reviews" to "anon";

grant insert on table "public"."tabular_reviews" to "anon";

grant select on table "public"."tabular_reviews" to "anon";

grant update on table "public"."tabular_reviews" to "anon";

grant delete on table "public"."tabular_reviews" to "authenticated";

grant insert on table "public"."tabular_reviews" to "authenticated";

grant select on table "public"."tabular_reviews" to "authenticated";

grant update on table "public"."tabular_reviews" to "authenticated";

grant delete on table "public"."tabular_reviews" to "service_role";

grant insert on table "public"."tabular_reviews" to "service_role";

grant select on table "public"."tabular_reviews" to "service_role";

grant update on table "public"."tabular_reviews" to "service_role";

grant delete on table "public"."task_templates" to "anon";

grant insert on table "public"."task_templates" to "anon";

grant select on table "public"."task_templates" to "anon";

grant update on table "public"."task_templates" to "anon";

grant delete on table "public"."task_templates" to "service_role";

grant insert on table "public"."task_templates" to "service_role";

grant select on table "public"."task_templates" to "service_role";

grant update on table "public"."task_templates" to "service_role";

grant delete on table "public"."tasks" to "anon";

grant insert on table "public"."tasks" to "anon";

grant select on table "public"."tasks" to "anon";

grant update on table "public"."tasks" to "anon";

grant delete on table "public"."tasks" to "service_role";

grant insert on table "public"."tasks" to "service_role";

grant select on table "public"."tasks" to "service_role";

grant update on table "public"."tasks" to "service_role";

grant delete on table "public"."telephony_webhook_events" to "service_role";

grant insert on table "public"."telephony_webhook_events" to "service_role";

grant select on table "public"."telephony_webhook_events" to "service_role";

grant update on table "public"."telephony_webhook_events" to "service_role";

grant delete on table "public"."template_builder_uploads" to "anon";

grant insert on table "public"."template_builder_uploads" to "anon";

grant select on table "public"."template_builder_uploads" to "anon";

grant update on table "public"."template_builder_uploads" to "anon";

grant delete on table "public"."template_builder_uploads" to "authenticated";

grant insert on table "public"."template_builder_uploads" to "authenticated";

grant select on table "public"."template_builder_uploads" to "authenticated";

grant update on table "public"."template_builder_uploads" to "authenticated";

grant delete on table "public"."template_builder_uploads" to "service_role";

grant insert on table "public"."template_builder_uploads" to "service_role";

grant select on table "public"."template_builder_uploads" to "service_role";

grant update on table "public"."template_builder_uploads" to "service_role";

grant delete on table "public"."user_api_keys" to "service_role";

grant insert on table "public"."user_api_keys" to "service_role";

grant select on table "public"."user_api_keys" to "service_role";

grant update on table "public"."user_api_keys" to "service_role";

grant delete on table "public"."user_mcp_connectors" to "service_role";

grant insert on table "public"."user_mcp_connectors" to "service_role";

grant select on table "public"."user_mcp_connectors" to "service_role";

grant update on table "public"."user_mcp_connectors" to "service_role";

grant delete on table "public"."user_mcp_oauth_tokens" to "service_role";

grant insert on table "public"."user_mcp_oauth_tokens" to "service_role";

grant select on table "public"."user_mcp_oauth_tokens" to "service_role";

grant update on table "public"."user_mcp_oauth_tokens" to "service_role";

grant delete on table "public"."users" to "anon";

grant insert on table "public"."users" to "anon";

grant select on table "public"."users" to "anon";

grant update on table "public"."users" to "anon";

grant delete on table "public"."users" to "authenticated";

grant insert on table "public"."users" to "authenticated";

grant select on table "public"."users" to "authenticated";

grant update on table "public"."users" to "authenticated";

grant delete on table "public"."users" to "service_role";

grant insert on table "public"."users" to "service_role";

grant select on table "public"."users" to "service_role";

grant update on table "public"."users" to "service_role";

grant delete on table "public"."work_run_artifacts" to "anon";

grant insert on table "public"."work_run_artifacts" to "anon";

grant select on table "public"."work_run_artifacts" to "anon";

grant update on table "public"."work_run_artifacts" to "anon";

grant delete on table "public"."work_run_artifacts" to "service_role";

grant insert on table "public"."work_run_artifacts" to "service_role";

grant select on table "public"."work_run_artifacts" to "service_role";

grant update on table "public"."work_run_artifacts" to "service_role";

grant delete on table "public"."work_runs" to "anon";

grant insert on table "public"."work_runs" to "anon";

grant select on table "public"."work_runs" to "anon";

grant update on table "public"."work_runs" to "anon";

grant delete on table "public"."work_runs" to "service_role";

grant insert on table "public"."work_runs" to "service_role";

grant select on table "public"."work_runs" to "service_role";

grant update on table "public"."work_runs" to "service_role";

grant delete on table "public"."work_skill_shares" to "anon";

grant insert on table "public"."work_skill_shares" to "anon";

grant select on table "public"."work_skill_shares" to "anon";

grant update on table "public"."work_skill_shares" to "anon";

grant delete on table "public"."work_skill_shares" to "service_role";

grant insert on table "public"."work_skill_shares" to "service_role";

grant select on table "public"."work_skill_shares" to "service_role";

grant update on table "public"."work_skill_shares" to "service_role";

grant delete on table "public"."work_skills" to "anon";

grant insert on table "public"."work_skills" to "anon";

grant select on table "public"."work_skills" to "anon";

grant update on table "public"."work_skills" to "anon";

grant delete on table "public"."work_skills" to "service_role";

grant insert on table "public"."work_skills" to "service_role";

grant select on table "public"."work_skills" to "service_role";

grant update on table "public"."work_skills" to "service_role";


