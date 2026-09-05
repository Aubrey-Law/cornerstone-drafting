-- Seeds the design-sheet issue-spotter as a published field_audit prompt:
-- six checks that read the client's own free text against the plan's
-- structured decisions for a Massachusetts trust matter.
--
-- Deliberately not six deterministic field comparisons. The fiduciary matrix
-- (see the funding/fiduciary work elsewhere in this app) already finds a
-- fiduciary appointment with no successor deterministically -- and found 14
-- of 33 chains in live data doing exactly that -- so this prompt has no
-- check for it: two sources of truth for one question is worse than one.
-- Likewise, "every staggered distribution has a distribution_age" is a
-- boolean test -- `staggered_distributions` set with `distribution_age`
-- null -- and coding six of those here would prove only that a model can
-- do `if`, while paying model prices for the privilege. What a model can do
-- that a deterministic checker cannot is read a concern recorded in the
-- client's own words against the structured decisions the design sheet
-- actually contains, and say whether the plan answers it. That is what all
-- six checks below test for.
--
-- Same seeding shape as 20261028010000_seed_review_playbook.sql: prompts,
-- then prompt_versions, then prompt_publications, every insert
-- `on conflict ... do nothing` so re-running this migration -- or running it
-- after someone has since edited the prompt through the app -- is a no-op.
--
-- Every input's `source` is drawn from packages/citations/src/prompt/inputs.ts's
-- SOURCE_ALLOW_LIST, and every check's `reads` names only fields the inputs
-- above declare -- `promptBodySchema` in packages/citations/src/prompt/body.ts
-- refuses to parse a body where that is not true, and
-- apps/workbench/tests/design-sheet-audit-content.test.ts parses this
-- migration's body against it.
--
-- The body's `content_hash` is the sha256 hex digest of
-- `JSON.stringify(body)`, computed with Node from the body actually seeded
-- below, not invented:
--
--   node -e '
--     const crypto = require("crypto");
--     const body = { kind: "field_audit", inputs: [ /* the 16 inputs below */ ], checks: [ /* the 6 checks below */ ] };
--     console.log(crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex"));
--   '
--
-- which printed 258f1d0e54303fa6f9307534e0381d2a75745451968c132c18289fb8eff24e74.

insert into public.prompts (id, slug, title, kind, stages, is_system)
values (
  'acd6881b-cfaa-4d44-ac24-8a47607d2d87',
  'ma-design-sheet-audit',
  'Massachusetts design sheet — issue spotter',
  'field_audit',
  array['design','drafting'],
  true
)
on conflict (slug) do nothing;

insert into public.prompt_versions (
  id, prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
values (
  '484437ec-8926-4167-a808-e5890c5a17a3',
  'acd6881b-cfaa-4d44-ac24-8a47607d2d87',
  'field_audit',
  1,
  '{"kind":"field_audit","inputs":[{"key":"concerns","source":"design_sheet.concerns","required":true},{"key":"goals_notes","source":"design_sheet.goals_notes","required":false},{"key":"drafting_notes","source":"design_sheet.drafting_notes","required":false},{"key":"children","source":"design_sheet.children","required":false},{"key":"assets","source":"design_sheet.assets","required":false},{"key":"specific_bequests","source":"design_sheet.specific_bequests","required":false},{"key":"disinheritances","source":"design_sheet.disinheritances","required":false},{"key":"residuary_beneficiary","source":"design_sheet.residuary_beneficiary","required":false},{"key":"residual_beneficiary_individuals","source":"design_sheet.residual_beneficiary_individuals","required":false},{"key":"residuary_distribution","source":"design_sheet.residuary_distribution","required":false},{"key":"spouse_citizenship","source":"design_sheet.spouse_citizenship","required":false},{"key":"include_qdot","source":"design_sheet.include_qdot","required":false},{"key":"marital_trust_type","source":"design_sheet.marital_trust_type","required":false},{"key":"real_property_transfer","source":"design_sheet.real_property_transfer","required":false},{"key":"state","source":"design_sheet.state","required":false},{"key":"client_domicile","source":"design_sheet.client_domicile","required":false}],"checks":[{"number":"1","risk":"blocker","reads":["concerns","goals_notes","residuary_beneficiary","residual_beneficiary_individuals","residuary_distribution","marital_trust_type"],"statement":"Every concern the client stated is answered somewhere in the plan''s structured decisions. A concern recorded in their own words and then left unaddressed by the residuary, the trust type or the fiduciary appointments is the failure this review exists to catch — the client said what mattered to them and the plan did not respond to it.","taskTemplate":{"title":"A stated concern is not answered by the plan","description":"The design sheet records a concern that the structured decisions do not address. Confirm whether the plan should change or the concern is recorded elsewhere.","priority":"high"}},{"number":"2","risk":"blocker","reads":["concerns","goals_notes","drafting_notes","children","residual_beneficiary_individuals","residuary_beneficiary"],"statement":"Every person named in the client''s free text appears in the structured decisions. A child or intended beneficiary who is mentioned by name in the concerns or notes but appears in no beneficiary or fiduciary field will be absent from the drafted instrument, and nobody will notice until it is signed.","taskTemplate":{"title":"A person named in the notes is missing from the plan","description":"Someone is named in the design sheet''s free text but appears in none of the beneficiary or fiduciary fields. Confirm whether they were meant to be included.","priority":"high"}},{"number":"3","risk":"high","reads":["specific_bequests","assets"],"statement":"Every specific bequest names something the asset list contains. A bequest of property the client does not own, or no longer owns, adeems — the beneficiary takes nothing, and the gift the client believed they had made silently fails.","taskTemplate":{"title":"A specific bequest names an asset not on the list","description":"A specific bequest refers to property the asset list does not record. Confirm ownership before drafting, or the gift may adeem.","priority":"normal"}},{"number":"4","risk":"high","reads":["disinheritances","residuary_beneficiary","residual_beneficiary_individuals","concerns"],"statement":"Every disinheritance is deliberate on its face and consistent with the residuary. An omission that reads as accidental invites a pretermitted-heir claim under MUPC c. 190B § 2-302, and a person recorded as disinherited who nonetheless appears among the residuary beneficiaries is a contradiction the drafting cannot resolve.","taskTemplate":{"title":"A disinheritance is unclear or contradicted","description":"The disinheritance record either states no reason or conflicts with the residuary. Confirm the intent and make the omission explicit in the drafting.","priority":"normal"}},{"number":"5","risk":"blocker","reads":["spouse_citizenship","include_qdot","marital_trust_type"],"statement":"A spouse who is not a United States citizen has a QDOT, or a recorded decision not to use one. IRC § 2056(d) denies the unlimited marital deduction outright for a non-citizen spouse absent a qualified domestic trust, and the citizenship field is free text where ''green card'', ''permanent resident'' and ''not a citizen'' all appear and all mean the same thing here.","taskTemplate":{"title":"Non-citizen spouse with no QDOT decision","description":"The spouse appears not to be a US citizen and no QDOT decision is recorded. IRC 2056(d) denies the marital deduction without one.","priority":"high"}},{"number":"6","risk":"high","reads":["assets","real_property_transfer","state","client_domicile"],"statement":"Every parcel of real property in the asset list has a transfer decision, and property outside Massachusetts has a plan for it. A trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier; and a Massachusetts trust alone does not avoid ancillary probate in the state where the other property sits.","taskTemplate":{"title":"Real property with no transfer decision","description":"The asset list records real property with no transfer decision, or property outside Massachusetts with no ancillary plan. Confirm how each parcel reaches the trust.","priority":"high"}}]}'::jsonb,
  '258f1d0e54303fa6f9307534e0381d2a75745451968c132c18289fb8eff24e74',
  'Initial seed: six checks reading the client''s free text against the plan''s structured decisions.',
  'valid'
)
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
values (
  'acd6881b-cfaa-4d44-ac24-8a47607d2d87',
  '484437ec-8926-4167-a808-e5890c5a17a3'
)
on conflict (prompt_id) do nothing;
