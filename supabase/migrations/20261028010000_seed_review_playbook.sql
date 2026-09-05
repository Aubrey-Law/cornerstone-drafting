-- Seeds the firm's one review playbook as a published prompt object, so
-- `apps/workbench/lib/review/playbook.ts` can stop importing it as a bundled
-- JSON file (`tools/workflows/review/ma-trust-firm-qa.json`, deleted in the
-- same change).
--
-- A second prompt kind (`field_audit`) is coming, and the whole point of
-- 20261028000000_prompt_objects.sql was to give both kinds one shape to live
-- in. A review that kept reading its one prompt from a file import would
-- leave that generalisation untested and give the app two sources of truth
-- for "what a prompt is" — the database rows the field-audit work will use,
-- and this one file the review path would keep trusting instead.
--
-- The body's `content_hash` is the sha256 hex digest of
-- `JSON.stringify({ kind: 'review', inputs: [], rules: <verbatim> })`,
-- computed with Node from the actual file being retired, not invented:
--
--   node -e '
--     const fs = require("fs");
--     const crypto = require("crypto");
--     const raw = JSON.parse(fs.readFileSync("tools/workflows/review/ma-trust-firm-qa.json", "utf8"));
--     const body = { kind: "review", inputs: [], rules: raw.rules };
--     console.log(crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"));
--   '
--
-- which printed 5d62f4436688a694c6640ee647c101cc0fcd458b23422a15059c63b2acaa76ec.
--
-- Every insert is `on conflict ... do nothing`, targeting each table's real
-- uniqueness (slug; prompt_id + version_number; the prompt_id primary key), so
-- running this migration twice — or after someone has since edited the
-- playbook through the app — is a no-op rather than an error or a duplicate.

insert into public.prompts (id, slug, title, kind, is_system)
values (
  'ffade3a2-0622-4a2b-81c6-4010cc7c96e8',
  'ma-trust-firm-qa',
  'Massachusetts revocable trust — firm quality review',
  'review',
  true
)
on conflict (slug) do nothing;

insert into public.prompt_versions (
  id, prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
values (
  '08125ee7-0986-4371-9ce6-8a56d0e516a4',
  'ffade3a2-0622-4a2b-81c6-4010cc7c96e8',
  'review',
  1,
  '{"kind":"review","inputs":[],"rules":[{"number":"1","risk":"high","statement":"Our exculpation and indemnity language carves out gross negligence and bad faith, not willful misconduct alone. A carve-out limited to willful misconduct leaves our beneficiaries without recourse for conduct well short of intentional wrongdoing, and is narrower than we intend to draft.","preferredLanguage":"except to the extent such claims arise from the Trustee''s own willful misconduct, bad faith, or gross negligence"},{"number":"2","risk":"medium","statement":"Our waiver of the trustee''s bond is limited to trustees named in the instrument and successors appointed under its terms. An unqualified waiver running to anyone who ever serves removes the protection at exactly the point it is needed — when a trustee nobody chose takes office."},{"number":"3","risk":"blocker","statement":"Every discretionary distribution standard we draft states whether the trustee considers a beneficiary''s other resources. Silence is the defect: it leaves our trustee to guess, and it changes both the tax treatment and the creditor exposure of the interest."}]}'::jsonb,
  '5d62f4436688a694c6640ee647c101cc0fcd458b23422a15059c63b2acaa76ec',
  'Seeded from tools/workflows/review/ma-trust-firm-qa.json (version 1), the last version that lived as a bundled file rather than a database row.',
  'valid'
)
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
values (
  'ffade3a2-0622-4a2b-81c6-4010cc7c96e8',
  '08125ee7-0986-4371-9ce6-8a56d0e516a4'
)
on conflict (prompt_id) do nothing;
