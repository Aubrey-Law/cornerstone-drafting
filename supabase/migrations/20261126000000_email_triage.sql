-- Email triage: the queue of client and lead mail waiting on a reply.
--
-- Snippets, never bodies. `snippet` is Gmail's own ~200-character preview and
-- is the most of any inbound message that is stored here. Bodies are read live
-- from Gmail when a draft is generated or the attorney opens a row, and then
-- discarded. Persisting them would make this database a second, unmanaged copy
-- of the mailbox: the same confidentiality duty, none of Gmail's retention
-- controls, a message deleted in Gmail surviving here, and mail from third
-- parties and opposing counsel stored in a system they never consented to. The
-- cost is one extra Gmail read per opened row, which at this volume is nothing.
--
-- The generated draft *is* stored, because it is the product. That is the firm's
-- own text, not the correspondent's.
--
-- `email_drafts` could not be reused. Its key is (user_id, context_type,
-- context_id) with exactly one row per context, because it exists to autosave
-- the compose box. Triage needs many rows per lead (three separate threads from
-- one client), rows for senders matching no CRM record, rows keyed by Gmail
-- thread, and a status lifecycle. Writing triage into it would clobber whatever
-- the attorney was half-way through composing — data loss, not an awkward fit.

CREATE TABLE IF NOT EXISTS public.email_triage_threads (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which mailbox this was scanned from. Part of the natural key: the same
  -- Gmail thread id can exist in two accounts and mean different things.
  connection_email       text NOT NULL,
  gmail_thread_id        text NOT NULL,
  -- The latest *inbound* message, the one a reply would answer. It moves when
  -- the client writes again, which is what invalidates a draft.
  gmail_message_id       text NOT NULL,
  message_id_header      text,
  references_header      text,
  thread_message_count   integer NOT NULL DEFAULT 0,

  sender_email           text NOT NULL,
  sender_name            text,
  -- Denormalised so a domain-level dismissal is one index lookup rather than a
  -- string function over every row.
  sender_domain          text NOT NULL,
  subject                text,
  snippet                text,
  received_at            timestamptz NOT NULL,

  classification         text NOT NULL
    CHECK (classification IN ('client', 'lead', 'contact', 'possible_lead')),
  classification_reason  text,
  client_intake_id       uuid REFERENCES public.client_intake(id) ON DELETE SET NULL,
  matter_id              uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  contact_id             uuid REFERENCES public.contacts(id) ON DELETE SET NULL,

  -- 'drafting' is a claim state, not a display state: the scan flips a row into
  -- it with a conditional update so a cron run and a manual refresh cannot
  -- draft the same thread twice and bill for both.
  status                 text NOT NULL DEFAULT 'needs_reply'
    CHECK (status IN ('needs_reply', 'drafting', 'drafted', 'approved', 'dismissed', 'replied', 'failed')),

  draft_subject          text,
  draft_body             text,
  draft_model            text,
  draft_generated_at     timestamptz,
  draft_error            text,

  gmail_draft_id         text,
  gmail_draft_message_id text,

  approved_at            timestamptz,
  approved_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dismissed_at           timestamptz,
  dismissed_reason       text,
  replied_at             timestamptz,

  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_scanned_at        timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- The conflict target for the scan's upsert, and the single line that makes a
-- rescan idempotent rather than duplicating the queue every morning.
CREATE UNIQUE INDEX IF NOT EXISTS email_triage_threads_mailbox_thread_key
  ON public.email_triage_threads (connection_email, gmail_thread_id);

CREATE INDEX IF NOT EXISTS email_triage_threads_status_idx
  ON public.email_triage_threads (status, received_at DESC);

CREATE INDEX IF NOT EXISTS email_triage_threads_sender_idx
  ON public.email_triage_threads (sender_email);

-- The sidebar badge counts exactly these three states.
CREATE INDEX IF NOT EXISTS email_triage_threads_open_idx
  ON public.email_triage_threads (received_at DESC)
  WHERE status IN ('needs_reply', 'drafting', 'drafted');

ALTER TABLE public.email_triage_threads ENABLE ROW LEVEL SECURITY;

-- Firm staff only, and never the client portal: this table is the firm's view
-- of its own mailbox, including mail about clients from people who are not them.
DROP POLICY IF EXISTS email_triage_threads_staff_all ON public.email_triage_threads;
CREATE POLICY email_triage_threads_staff_all
  ON public.email_triage_threads FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_triage_threads TO authenticated;

COMMENT ON TABLE public.email_triage_threads IS
  'Gmail threads where a client or lead is waiting on a reply, with the drafted '
  'response. Stores Gmail''s snippet only — message bodies are read live from '
  'Gmail and never persisted here. See lib/emailTriage/.';

COMMENT ON COLUMN public.email_triage_threads.snippet IS
  'Gmail''s own short preview. Deliberately the most of an inbound message that '
  'is stored; the full body is fetched on demand and discarded.';


-- Senders the attorney never wants to see again.
--
-- A table rather than a constant because maintenance has to be a click. The
-- dismiss control writes rows here; structural rules (List-Unsubscribe headers,
-- noreply local parts, Precedence: bulk) stay in code, because those are
-- protocol facts rather than firm preferences.
CREATE TABLE IF NOT EXISTS public.email_triage_ignore_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('domain', 'address')),
  value      text NOT NULL,
  note       text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_triage_ignore_rules_kind_value_key
  ON public.email_triage_ignore_rules (kind, lower(value));

ALTER TABLE public.email_triage_ignore_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_triage_ignore_rules_staff_all ON public.email_triage_ignore_rules;
CREATE POLICY email_triage_ignore_rules_staff_all
  ON public.email_triage_ignore_rules FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_triage_ignore_rules TO authenticated;

-- Seeded with the vendors this application already knows the firm corresponds
-- with, so the first morning's queue is not mostly receipts. Everything here is
-- removable; none of it is load-bearing.
INSERT INTO public.email_triage_ignore_rules (kind, value, note) VALUES
  ('domain', 'google.com',           'seed: platform notifications'),
  ('domain', 'accounts.google.com',  'seed: platform notifications'),
  ('domain', 'vercel.com',           'seed: platform notifications'),
  ('domain', 'supabase.io',          'seed: platform notifications'),
  ('domain', 'supabase.com',         'seed: platform notifications'),
  ('domain', 'github.com',           'seed: platform notifications'),
  ('domain', 'intuit.com',           'seed: accounting'),
  ('domain', 'quickbooks.com',       'seed: accounting'),
  ('domain', 'stripe.com',           'seed: payments'),
  ('domain', 'lawpay.com',           'seed: payments'),
  ('domain', 'docusign.net',         'seed: e-sign'),
  ('domain', 'calendly.com',         'seed: scheduling'),
  ('domain', 'zoom.us',              'seed: meetings'),
  ('domain', 'linkedin.com',         'seed: social'),
  ('domain', 'facebook.com',         'seed: social'),
  ('domain', 'mailchimp.com',        'seed: marketing'),
  ('domain', 'thomsonreuters.com',   'seed: research'),
  ('domain', 'lexisnexis.com',       'seed: research'),
  ('domain', 'massbar.org',          'seed: bar association'),
  ('domain', 'ups.com',              'seed: shipping'),
  ('domain', 'fedex.com',            'seed: shipping')
ON CONFLICT DO NOTHING;


-- One row per scan. Powers "last scanned 12 minutes ago", supplies the
-- incremental `after:` clause so a rescan does not re-read two weeks of mail,
-- and is the in-flight mutex: consumeRateLimit fails open by design and cannot
-- be used for correctness here.
CREATE TABLE IF NOT EXISTS public.email_triage_scans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger            text NOT NULL CHECK (trigger IN ('cron', 'manual')),
  actor_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  threads_listed     integer NOT NULL DEFAULT 0,
  threads_examined   integer NOT NULL DEFAULT 0,
  threads_queued     integer NOT NULL DEFAULT 0,
  threads_resolved   integer NOT NULL DEFAULT 0,
  skipped_automated  integer NOT NULL DEFAULT 0,
  skipped_internal   integer NOT NULL DEFAULT 0,
  drafts_generated   integer NOT NULL DEFAULT 0,
  error              text
);

CREATE INDEX IF NOT EXISTS email_triage_scans_started_idx
  ON public.email_triage_scans (started_at DESC);

-- Finds the in-flight run. Partial, because that is the only query this index
-- ever serves and unfinished rows are a vanishing fraction of the table.
CREATE INDEX IF NOT EXISTS email_triage_scans_in_flight_idx
  ON public.email_triage_scans (started_at DESC)
  WHERE finished_at IS NULL;

ALTER TABLE public.email_triage_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_triage_scans_staff_select ON public.email_triage_scans;
CREATE POLICY email_triage_scans_staff_select
  ON public.email_triage_scans FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = (select auth.uid()) AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT ON public.email_triage_scans TO authenticated;


-- Off by default. The feature dark-launches, and production can switch it off
-- with one UPDATE rather than a redeploy — which matters for a feature whose
-- failure mode is reading a mailbox.
ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS email_triage_enabled boolean NOT NULL DEFAULT false;

-- An override for the Gmail search the scan runs, so the query can be tuned
-- against real mail with one SQL statement. NULL means the code's default.
ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS email_triage_query text;

NOTIFY pgrst, 'reload schema';
