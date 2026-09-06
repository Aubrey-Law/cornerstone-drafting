-- Version 2 of the design-sheet issue-spotter (packages/citations/src/fieldAudit,
-- seeded at 20261028020000). WHY this version exists:
--
-- Checks 1 and 2 ask whether a person the client named is answered for
-- somewhere in the plan, while being shown only the beneficiary fields --
-- `concerns, goals_notes, residuary_beneficiary, residual_beneficiary_individuals,
-- residuary_distribution, marital_trust_type` for check 1, and the same shape
-- for check 2. Neither reads a single guardian, trustee, executor, health-care-
-- proxy or power-of-attorney field. Run against a real matter at drafting
-- stage, both checks reported a named guardian ("Thomas Parker", "Susan
-- Purdue", "Robin Parker") as missing from the plan -- as blockers -- when
-- every one of them was in fact recorded, across guardian_primary,
-- guardian_slots and temporary_guardian_slots. The model answered honestly
-- about what it was shown; it was shown the wrong fields. Two false-positive
-- blockers on one real matter is the reason version 2 exists.
--
-- What changed from version 1:
--   * New inputs declare the name-bearing fiduciary fields (guardian_primary,
--     guardian_alt1, trustee_primary, trustee_alt1, executor_primary,
--     hcp_primary, poa_primary, spouse_name, client_name) and the six
--     `*_slots` fields, which apps/workbench/lib/prompts/designSheet.ts now
--     resolves from `[{contact_id, ...}]` to `[{name, ...}]` before a prompt
--     ever sees them -- a contact_id is a foreign key, not a fact a model can
--     quote.
--   * Check 1 ("a stated concern is answered somewhere in the plan") now also
--     reads the fiduciary appointment fields (guardian/trustee/executor/hcp/poa
--     primary + alt1): a concern naming a guardian is answered by a guardian
--     appointment, and check 1 could not see one before.
--   * Check 2 ("every person named in the client's free text appears in the
--     structured decisions") now also reads every name-bearing fiduciary
--     field and the resolved slots: it asks whether a person appears
--     *anywhere* in the plan, so it has to see everywhere a person can be
--     recorded, not only the beneficiary fields.
--   * Checks 3, 4, 5, 6 are unchanged from version 1.
--
-- Same seeding shape as 20261028010000_seed_review_playbook.sql (and
-- 20261028020000 itself): a new prompt_versions row, `on conflict
-- (prompt_id, version_number) do nothing` so re-running this migration is a
-- no-op. `prompt_publications` is the one exception to plain
-- `on conflict ... do nothing`: its primary key is `prompt_id`, and a row for
-- this prompt already exists (pointing at version 1) from 20261028020000, so
-- `do nothing` on conflict would leave every future run pinned to the very
-- version this migration exists to retire. Repointing it is the point of
-- this migration, so its upsert instead does
-- `on conflict (prompt_id) do update set version_id = excluded.version_id,
-- published_at = excluded.published_at` -- idempotent the same way a plain
-- `do nothing` insert is (re-running it sets the same values again), but
-- actually moves the pointer instead of refusing to.
--
-- version 1 is never edited -- prompt_versions is immutable by design (see
-- the header comment on that table in 20261028000000_prompt_objects.sql) --
-- this migration only adds a new version and moves the publication pointer.
--
-- The body's `content_hash` is the sha256 hex digest of
-- `JSON.stringify(body)`, computed with Node from the body actually seeded
-- below (version 1's body, plus the inputs and reads described above), not
-- invented:
--
--   node -e '
--     const crypto = require("crypto");
--     const body = { kind: "field_audit", inputs: [ /* the 31 inputs below */ ], checks: [ /* the 6 checks below, 1 and 2 with wider reads */ ] };
--     console.log(crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"));
--   '
--
-- which printed dffa7977530d5cb558cfc555549def11f687885ff4aeb7435a5fb798803320d0.

insert into public.prompt_versions (
  id, prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
values (
  'db3b117e-890f-4e34-8147-2560fe35dc4a',
  'acd6881b-cfaa-4d44-ac24-8a47607d2d87',
  'field_audit',
  2,
  '{"kind":"field_audit","inputs":[{"key":"concerns","source":"design_sheet.concerns","required":true},{"key":"goals_notes","source":"design_sheet.goals_notes","required":false},{"key":"drafting_notes","source":"design_sheet.drafting_notes","required":false},{"key":"children","source":"design_sheet.children","required":false},{"key":"assets","source":"design_sheet.assets","required":false},{"key":"specific_bequests","source":"design_sheet.specific_bequests","required":false},{"key":"disinheritances","source":"design_sheet.disinheritances","required":false},{"key":"residuary_beneficiary","source":"design_sheet.residuary_beneficiary","required":false},{"key":"residual_beneficiary_individuals","source":"design_sheet.residual_beneficiary_individuals","required":false},{"key":"residuary_distribution","source":"design_sheet.residuary_distribution","required":false},{"key":"spouse_citizenship","source":"design_sheet.spouse_citizenship","required":false},{"key":"include_qdot","source":"design_sheet.include_qdot","required":false},{"key":"marital_trust_type","source":"design_sheet.marital_trust_type","required":false},{"key":"real_property_transfer","source":"design_sheet.real_property_transfer","required":false},{"key":"state","source":"design_sheet.state","required":false},{"key":"client_domicile","source":"design_sheet.client_domicile","required":false},{"key":"guardian_primary","source":"design_sheet.guardian_primary","required":false},{"key":"guardian_alt1","source":"design_sheet.guardian_alt1","required":false},{"key":"trustee_primary","source":"design_sheet.trustee_primary","required":false},{"key":"trustee_alt1","source":"design_sheet.trustee_alt1","required":false},{"key":"executor_primary","source":"design_sheet.executor_primary","required":false},{"key":"hcp_primary","source":"design_sheet.hcp_primary","required":false},{"key":"poa_primary","source":"design_sheet.poa_primary","required":false},{"key":"spouse_name","source":"design_sheet.spouse_name","required":false},{"key":"client_name","source":"design_sheet.client_name","required":false},{"key":"guardian_slots","source":"design_sheet.guardian_slots","required":false},{"key":"temporary_guardian_slots","source":"design_sheet.temporary_guardian_slots","required":false},{"key":"trustee_slots","source":"design_sheet.trustee_slots","required":false},{"key":"executor_slots","source":"design_sheet.executor_slots","required":false},{"key":"hcp_slots","source":"design_sheet.hcp_slots","required":false},{"key":"poa_slots","source":"design_sheet.poa_slots","required":false}],"checks":[{"number":"1","risk":"blocker","reads":["concerns","goals_notes","residuary_beneficiary","residual_beneficiary_individuals","residuary_distribution","marital_trust_type","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary"],"statement":"Every concern the client stated is answered somewhere in the plan''s structured decisions. A concern recorded in their own words and then left unaddressed by the residuary, the trust type or the fiduciary appointments is the failure this review exists to catch — the client said what mattered to them and the plan did not respond to it.","taskTemplate":{"title":"A stated concern is not answered by the plan","description":"The design sheet records a concern that the structured decisions do not address. Confirm whether the plan should change or the concern is recorded elsewhere.","priority":"high"}},{"number":"2","risk":"blocker","reads":["concerns","goals_notes","drafting_notes","children","residual_beneficiary_individuals","residuary_beneficiary","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","spouse_name","client_name","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every person named in the client''s free text appears in the structured decisions. A child or intended beneficiary who is mentioned by name in the concerns or notes but appears in no beneficiary or fiduciary field will be absent from the drafted instrument, and nobody will notice until it is signed.","taskTemplate":{"title":"A person named in the notes is missing from the plan","description":"Someone is named in the design sheet''s free text but appears in none of the beneficiary or fiduciary fields. Confirm whether they were meant to be included.","priority":"high"}},{"number":"3","risk":"high","reads":["specific_bequests","assets"],"statement":"Every specific bequest names something the asset list contains. A bequest of property the client does not own, or no longer owns, adeems — the beneficiary takes nothing, and the gift the client believed they had made silently fails.","taskTemplate":{"title":"A specific bequest names an asset not on the list","description":"A specific bequest refers to property the asset list does not record. Confirm ownership before drafting, or the gift may adeem.","priority":"normal"}},{"number":"4","risk":"high","reads":["disinheritances","residuary_beneficiary","residual_beneficiary_individuals","concerns"],"statement":"Every disinheritance is deliberate on its face and consistent with the residuary. An omission that reads as accidental invites a pretermitted-heir claim under MUPC c. 190B § 2-302, and a person recorded as disinherited who nonetheless appears among the residuary beneficiaries is a contradiction the drafting cannot resolve.","taskTemplate":{"title":"A disinheritance is unclear or contradicted","description":"The disinheritance record either states no reason or conflicts with the residuary. Confirm the intent and make the omission explicit in the drafting.","priority":"normal"}},{"number":"5","risk":"blocker","reads":["spouse_citizenship","include_qdot","marital_trust_type"],"statement":"A spouse who is not a United States citizen has a QDOT, or a recorded decision not to use one. IRC § 2056(d) denies the unlimited marital deduction outright for a non-citizen spouse absent a qualified domestic trust, and the citizenship field is free text where ''green card'', ''permanent resident'' and ''not a citizen'' all appear and all mean the same thing here.","taskTemplate":{"title":"Non-citizen spouse with no QDOT decision","description":"The spouse appears not to be a US citizen and no QDOT decision is recorded. IRC 2056(d) denies the marital deduction without one.","priority":"high"}},{"number":"6","risk":"high","reads":["assets","real_property_transfer","state","client_domicile"],"statement":"Every parcel of real property in the asset list has a transfer decision, and property outside Massachusetts has a plan for it. A trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier; and a Massachusetts trust alone does not avoid ancillary probate in the state where the other property sits.","taskTemplate":{"title":"Real property with no transfer decision","description":"The asset list records real property with no transfer decision, or property outside Massachusetts with no ancillary plan. Confirm how each parcel reaches the trust.","priority":"high"}}]}'::jsonb,
  'dffa7977530d5cb558cfc555549def11f687885ff4aeb7435a5fb798803320d0',
  'Checks 1 and 2 now read the name-bearing fiduciary fields and the resolved *_slots, after both reported a named guardian as missing from a real matter''s plan while being shown only the beneficiary fields.',
  'valid'
)
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
values (
  'acd6881b-cfaa-4d44-ac24-8a47607d2d87',
  'db3b117e-890f-4e34-8147-2560fe35dc4a'
)
on conflict (prompt_id) do update
  set version_id = excluded.version_id,
      published_at = excluded.published_at;
