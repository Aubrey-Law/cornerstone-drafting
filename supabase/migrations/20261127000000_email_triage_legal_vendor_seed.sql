-- Seed the triage ignore list with the vendors this firm actually corresponds
-- with, rather than the ones a generic SaaS product would.
--
-- The original seed named Google, Stripe, DocuSign, Mailchimp — plausible, and
-- almost entirely beside the point. The first production scan queued 17 threads
-- and 10 of them were plan administration and vendor notices: LegalEASE claims
-- alone accounted for seven, each read as a possible new lead, each a candidate
-- for a drafted reply nobody would ever send.
--
-- These are the domains a Massachusetts estate-planning practice hears from
-- weekly. Every row is removable from the page, and none of it is load-bearing:
-- an over-eager entry costs one dismissal to undo, where a missing one costs a
-- morning of noise and a handful of wasted drafts.
--
-- Legal-plan administration is deliberately on this list. It is real work, but
-- it is billing work — handled by the legalease-billing and metlife-claim
-- skills — and it is never answered with a drafted reply, which is the only
-- thing triage produces.

INSERT INTO public.email_triage_ignore_rules (kind, value, note) VALUES
  -- Legal plan administration and referral networks.
  ('domain', 'legaleaseplan.com',        'seed: LegalEASE claims - billing, handled by the legalease-billing skill'),
  ('domain', 'legalplans.com',           'seed: MetLife legal plans panel - handled by the metlife-claim skill'),
  ('domain', 'clcadvantage.com',         'seed: CLC referral notifications'),
  ('domain', 'arag.com',                 'seed: ARAG legal plan administration'),
  ('domain', 'legalshield.com',          'seed: legal plan administration'),

  -- Recording, title and court filing.
  ('domain', 'simplifile.com',           'seed: e-recording notices'),
  ('domain', 'efilema.com',              'seed: Massachusetts e-filing notices'),
  ('domain', 'masscourts.org',           'seed: court system notices'),

  -- Payments and practice tooling that mails notifications rather than people.
  ('domain', 'messaging.squareup.com',   'seed: Square invoice notifications - the notification subdomain only'),
  ('domain', 'squareup.com',             'seed: Square notifications'),
  ('domain', 'clio.com',                 'seed: practice management notifications'),
  ('domain', 'smokeball.com',            'seed: practice management notifications'),
  ('domain', 'dropbox.com',              'seed: file sharing notifications'),
  ('domain', 'box.com',                  'seed: file sharing notifications'),
  ('domain', 'slack.com',                'seed: platform notifications'),
  ('domain', 'ringcentral.com',          'seed: telephony notifications'),
  ('domain', 'twilio.com',               'seed: telephony notifications'),
  ('domain', 'notifications.google.com', 'seed: platform notifications')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
