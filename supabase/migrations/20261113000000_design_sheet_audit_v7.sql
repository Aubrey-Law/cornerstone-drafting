-- Check 2 says which direction it audits.
--
-- Version 5 fixed check 2's other defect: a statement containing two
-- questions, which produced a false blocker one run in six. It stated the
-- trigger positively -- "the name must be written in that free text to be in
-- scope" -- and never stated the converse. That omission is this bug.
--
-- Measured 2026-09-08 on a client_review sheet, seven runs under version 6,
-- input byte-identical every time (concerns md5 f4c38a1a, unchanged since
-- 2026-08-04): check 2 reported a blocker SEVEN times out of SEVEN, and all
-- seven rationales are stuck on the same thing. The sheet records Patricia
-- Chapman in trustee_slots and nowhere in the free text. Every run notices
-- her, asks whether she appears in the concerns, and treats her absence there
-- as the violation -- which is the inverse of the question. Every run then
-- confirms the two names that ARE in the free text are both captured, meaning
-- no finding exists, and reports `deviation` regardless. The visible
-- self-corrections in the rationales ("actually check:", "but wait",
-- "wait, Patricia Chapman is not in concerns") are the model catching the
-- error and landing on the wrong answer anyway.
--
-- So version 7 states the converse: the direction is one-way, and a person in
-- the structured decisions who is absent from the free text is the ordinary
-- case rather than an omission. A trustee named in a slot and nowhere else is
-- how every sheet records fiduciaries.
--
-- WHY THIS SHEET AND NOT THE OTHER ONE. Every earlier measurement of this
-- audit came from repeatedly running one matter at `drafting`, which has no
-- structured-only name. Seven runs there could not have surfaced this, and did
-- not. The defect appeared on the first sheet that had one, which is also how
-- check 6's vacuous-premise bug appeared the same day.
--
-- WHAT IT STILL CATCHES, and the test asserts this rather than trusting it: a
-- name written in the client's free text that appears in no structured field
-- is still a blocker. This is the second narrowing of check 2 in two days, and
-- narrowing twice is how a check gets silenced by accident.
--
-- Deliberation leaking into the rationale is deliberately NOT addressed here.
-- The instructions already ask for one or two sentences, and changing them is a
-- render-version change touching every check on both engines. If the direction
-- rule removes the confusion the rambling should go with it; if it does not,
-- that is a separate measurement.
--
-- Checks 1, 3, 4, 5 and 6 are byte-identical to version 6, and so are the
-- inputs, the outputTarget and check 2's own reads and taskTemplate -- asserted
-- structurally while building this migration, not trusted to this comment.

insert into public.prompt_versions (
  prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
select
  p.id,
  'field_audit',
  7,
  '{"kind":"field_audit","outputTarget":"checklist","inputs":[{"key":"concerns","source":"design_sheet.concerns","required":true},{"key":"goals_notes","source":"design_sheet.goals_notes","required":false},{"key":"drafting_notes","source":"design_sheet.drafting_notes","required":false},{"key":"children","source":"design_sheet.children","required":false},{"key":"assets","source":"design_sheet.assets","required":false},{"key":"specific_bequests","source":"design_sheet.specific_bequests","required":false},{"key":"disinheritances","source":"design_sheet.disinheritances","required":false},{"key":"residuary_beneficiary","source":"design_sheet.residuary_beneficiary","required":false},{"key":"residual_beneficiary_individuals","source":"design_sheet.residual_beneficiary_individuals","required":false},{"key":"residuary_distribution","source":"design_sheet.residuary_distribution","required":false},{"key":"spouse_citizenship","source":"design_sheet.spouse_citizenship","required":false},{"key":"include_qdot","source":"design_sheet.include_qdot","required":false},{"key":"marital_trust_type","source":"design_sheet.marital_trust_type","required":false},{"key":"real_property_transfer","source":"design_sheet.real_property_transfer","required":false},{"key":"state","source":"design_sheet.state","required":false},{"key":"client_domicile","source":"design_sheet.client_domicile","required":false},{"key":"guardian_primary","source":"design_sheet.guardian_primary","required":false},{"key":"guardian_alt1","source":"design_sheet.guardian_alt1","required":false},{"key":"trustee_primary","source":"design_sheet.trustee_primary","required":false},{"key":"trustee_alt1","source":"design_sheet.trustee_alt1","required":false},{"key":"executor_primary","source":"design_sheet.executor_primary","required":false},{"key":"hcp_primary","source":"design_sheet.hcp_primary","required":false},{"key":"poa_primary","source":"design_sheet.poa_primary","required":false},{"key":"spouse_name","source":"design_sheet.spouse_name","required":false},{"key":"client_name","source":"design_sheet.client_name","required":false},{"key":"guardian_slots","source":"design_sheet.guardian_slots","required":false},{"key":"temporary_guardian_slots","source":"design_sheet.temporary_guardian_slots","required":false},{"key":"trustee_slots","source":"design_sheet.trustee_slots","required":false},{"key":"executor_slots","source":"design_sheet.executor_slots","required":false},{"key":"hcp_slots","source":"design_sheet.hcp_slots","required":false},{"key":"poa_slots","source":"design_sheet.poa_slots","required":false}],"checks":[{"number":"1","risk":"blocker","reads":["concerns","goals_notes","residuary_beneficiary","residual_beneficiary_individuals","residuary_distribution","marital_trust_type","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every concern the client stated has a provision in the plan responsive to it — a residuary that reflects it, a trust type that accommodates it, a fiduciary appointed to carry it out. Report the substance only: whether the plan does the thing the concern asks for. A person named in the concerns who appears nowhere in the structured decisions is check 2''s finding and not this one; reporting it here as well raises two blockers for one gap, and an attorney reading a list of two learns less than one who reads a list of one.","taskTemplate":{"title":"A stated concern is not answered by the plan","description":"The design sheet records a concern the plan makes no provision for. Confirm whether the plan should change or the concern is answered elsewhere. If the concern is that a named person is missing, that is a separate finding.","priority":"high"}},{"number":"2","risk":"blocker","reads":["concerns","goals_notes","drafting_notes","children","residual_beneficiary_individuals","residuary_beneficiary","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","spouse_name","client_name","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every person whose name appears in the client''s free text — concerns, goals_notes or drafting_notes — also appears somewhere in the structured decisions. The name must be written in that free text to be in scope: a category such as \"descendants\", \"my children\" or \"issue\" names nobody. The direction is one-way. Free text → structured decisions, never the reverse. A person who appears in the structured decisions but not in the free text is not a finding and never was: a trustee, guardian or executor recorded in a slot and nowhere else is the ordinary case, not an omission. If you find yourself asking whether a name in a fiduciary slot appears in the concerns, you are auditing the wrong direction — stop, and answer the question in the first sentence. \"Appears in the structured decisions\" means any of them — a beneficiary field, a fiduciary field, spouse_name or client_name all count; a person need not be a beneficiary to be captured. Report only this: a person the client wrote by name whom the structured decisions never mention, who will therefore be absent from the drafted instrument with nobody noticing until it is signed. Whether the plan records a provision the concerns ask for — a residuary reflecting the client''s intent, for instance — is check 1''s finding and not this one, even when the fields it would live in are empty.","taskTemplate":{"title":"A person named in the notes is missing from the plan","description":"Someone is named in the design sheet''s free text but appears in none of the beneficiary or fiduciary fields. Confirm whether they were meant to be included.","priority":"high"}},{"number":"3","risk":"high","reads":["specific_bequests","assets"],"statement":"Every specific bequest names something the asset list contains. A bequest of property the client does not own, or no longer owns, adeems — the beneficiary takes nothing, and the gift the client believed they had made silently fails.","taskTemplate":{"title":"A specific bequest names an asset not on the list","description":"A specific bequest refers to property the asset list does not record. Confirm ownership before drafting, or the gift may adeem.","priority":"normal"}},{"number":"4","risk":"high","reads":["disinheritances","residuary_beneficiary","residual_beneficiary_individuals","concerns"],"statement":"Every disinheritance is deliberate on its face and consistent with the residuary. An omission that reads as accidental invites a pretermitted-heir claim under MUPC c. 190B § 2-302, and a person recorded as disinherited who nonetheless appears among the residuary beneficiaries is a contradiction the drafting cannot resolve.","taskTemplate":{"title":"A disinheritance is unclear or contradicted","description":"The disinheritance record either states no reason or conflicts with the residuary. Confirm the intent and make the omission explicit in the drafting.","priority":"normal"}},{"number":"5","risk":"blocker","reads":["spouse_citizenship","include_qdot","marital_trust_type"],"statement":"A spouse who is not a United States citizen has a QDOT, or a recorded decision not to use one. IRC § 2056(d) denies the unlimited marital deduction outright for a non-citizen spouse absent a qualified domestic trust, and the citizenship field is free text where ''green card'', ''permanent resident'' and ''not a citizen'' all appear and all mean the same thing here.","taskTemplate":{"title":"Non-citizen spouse with no QDOT decision","description":"The spouse appears not to be a US citizen and no QDOT decision is recorded. IRC 2056(d) denies the marital deduction without one.","priority":"high"}},{"number":"6","risk":"high","reads":["assets","real_property_transfer","state","client_domicile"],"statement":"Every parcel of real property recorded in the assets field has a transfer decision, and property outside Massachusetts has a plan for it. The asset list is the whole subject: if assets records no real property — including when it is empty — this check does not apply. Real property described only in the concerns or the notes is not a parcel in the asset list; that the sheet records no asset the concerns describe is check 1''s finding, not this one. Reporting it here cites two empty fields as though they were a parcel and its missing decision, which verifies and supports nothing. A trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier; and a Massachusetts trust alone does not avoid ancillary probate in the state where the other property sits.","taskTemplate":{"title":"Real property with no transfer decision","description":"The asset list records real property with no transfer decision, or property outside Massachusetts with no ancillary plan. Confirm how each parcel reaches the trust.","priority":"high"}}]}'::jsonb,
  '7246dcc616f7c7eef717d04a7951275fe125f3358b9bcdfc1f29eb2959434779',
  'Check 2 audits one direction: free text to structured decisions. A name in a fiduciary slot that is absent from the free text is the ordinary case, not a finding.',
  'valid'
from public.prompts p
where p.slug = 'ma-design-sheet-audit'
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
select v.prompt_id, v.id
from public.prompt_versions v
join public.prompts p on p.id = v.prompt_id
where p.slug = 'ma-design-sheet-audit' and v.version_number = 7
on conflict (prompt_id) do update set version_id = excluded.version_id, published_at = now();

notify pgrst, 'reload schema';
