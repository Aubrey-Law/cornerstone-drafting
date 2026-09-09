-- Check 1 says whether a described asset is a stated concern.
--
-- It is, and that is the owner's ruling of 2026-09-09. The statement did not
-- say so, and both readings were defensible from it.
--
-- Measured on one client_review sheet, 29 runs, concerns md5 f4c38a1a
-- throughout: deviation 28 times, not_applicable once. Both answers name the
-- same ambiguity in their own words. The sheet's concerns field holds an asset
-- inventory -- accounts, insurance, real property equity, spouse and referral
-- source -- rather than stated goals, and goals_notes is empty. So the check
-- asks something the sheet does not cleanly answer: is property the client
-- described a "concern the client stated"?
--
--   The 28: "the concerns do imply a married couple with young children and
--   significant assets who would need a plan for distribution to
--   spouse/children; residuary_beneficiary, residuary_distribution and
--   marital_trust_type are all empty."
--
--   The 1: "no concern actually calls for a residuary scheme or trust type ...
--   there is no stated concern with a corresponding responsive provision to
--   evaluate -- nor is there a mismatch."
--
-- THE DISSENTING RUN WAS THE MORE THOROUGH ONE. It cited 10 verified
-- references against the others' 5. So this is not a lazy answer to be
-- outvoted; it is a second reading a careful reader can reach, which is why
-- closing it needs wording rather than hope.
--
-- Same defect check 2 had under version 4 -- one statement, two defensible
-- questions, one picked per run -- and the same remedy version 5 used: resolve
-- it in the owner's favour and say which reading lost. The split here is far
-- more lopsided (28:1 against 5:1), so this changes almost no outcome. What it
-- removes is a blocker that vanishes from the advisory list about one run in
-- thirty, which is the failure mode that makes an advisory worthless.
--
-- CONSEQUENCE, NAMED. This makes check 1 fire more readily across the matter
-- list, not less: any sheet whose concerns describe assets while the residuary
-- fields sit empty is now unambiguously a blocker. Twelve of the nineteen
-- client_review sheets have an empty concerns field and are unaffected -- a
-- required input nobody filled in makes the run a recorded skip, never a
-- finding. The seven with content will now answer consistently.
--
-- Checks 2 through 6 are byte-identical to version 7, and so are the inputs,
-- the outputTarget and check 1's own reads and taskTemplate -- asserted
-- structurally while building this migration rather than trusted to this
-- comment.

insert into public.prompt_versions (
  prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
select
  p.id,
  'field_audit',
  8,
  '{"kind":"field_audit","outputTarget":"checklist","inputs":[{"key":"concerns","source":"design_sheet.concerns","required":true},{"key":"goals_notes","source":"design_sheet.goals_notes","required":false},{"key":"drafting_notes","source":"design_sheet.drafting_notes","required":false},{"key":"children","source":"design_sheet.children","required":false},{"key":"assets","source":"design_sheet.assets","required":false},{"key":"specific_bequests","source":"design_sheet.specific_bequests","required":false},{"key":"disinheritances","source":"design_sheet.disinheritances","required":false},{"key":"residuary_beneficiary","source":"design_sheet.residuary_beneficiary","required":false},{"key":"residual_beneficiary_individuals","source":"design_sheet.residual_beneficiary_individuals","required":false},{"key":"residuary_distribution","source":"design_sheet.residuary_distribution","required":false},{"key":"spouse_citizenship","source":"design_sheet.spouse_citizenship","required":false},{"key":"include_qdot","source":"design_sheet.include_qdot","required":false},{"key":"marital_trust_type","source":"design_sheet.marital_trust_type","required":false},{"key":"real_property_transfer","source":"design_sheet.real_property_transfer","required":false},{"key":"state","source":"design_sheet.state","required":false},{"key":"client_domicile","source":"design_sheet.client_domicile","required":false},{"key":"guardian_primary","source":"design_sheet.guardian_primary","required":false},{"key":"guardian_alt1","source":"design_sheet.guardian_alt1","required":false},{"key":"trustee_primary","source":"design_sheet.trustee_primary","required":false},{"key":"trustee_alt1","source":"design_sheet.trustee_alt1","required":false},{"key":"executor_primary","source":"design_sheet.executor_primary","required":false},{"key":"hcp_primary","source":"design_sheet.hcp_primary","required":false},{"key":"poa_primary","source":"design_sheet.poa_primary","required":false},{"key":"spouse_name","source":"design_sheet.spouse_name","required":false},{"key":"client_name","source":"design_sheet.client_name","required":false},{"key":"guardian_slots","source":"design_sheet.guardian_slots","required":false},{"key":"temporary_guardian_slots","source":"design_sheet.temporary_guardian_slots","required":false},{"key":"trustee_slots","source":"design_sheet.trustee_slots","required":false},{"key":"executor_slots","source":"design_sheet.executor_slots","required":false},{"key":"hcp_slots","source":"design_sheet.hcp_slots","required":false},{"key":"poa_slots","source":"design_sheet.poa_slots","required":false}],"checks":[{"number":"1","risk":"blocker","reads":["concerns","goals_notes","residuary_beneficiary","residual_beneficiary_individuals","residuary_distribution","marital_trust_type","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every concern the client stated has a provision in the plan responsive to it — a residuary that reflects it, a trust type that accommodates it, a fiduciary appointed to carry it out. A concern need not be phrased as a goal. An asset the client described is a concern: property recorded with nothing directing where it goes is precisely the gap this check exists to find, and an empty goals_notes is not a reason to pass. Do not require the client to have written \"avoid probate\" or \"provide for the children\" before a missing residuary counts. Report the substance only: whether the plan does the thing the concern asks for. A person named in the concerns who appears nowhere in the structured decisions is check 2''s finding and not this one; reporting it here as well raises two blockers for one gap, and an attorney reading a list of two learns less than one who reads a list of one.","taskTemplate":{"title":"A stated concern is not answered by the plan","description":"The design sheet records a concern the plan makes no provision for. Confirm whether the plan should change or the concern is answered elsewhere. If the concern is that a named person is missing, that is a separate finding.","priority":"high"}},{"number":"2","risk":"blocker","reads":["concerns","goals_notes","drafting_notes","children","residual_beneficiary_individuals","residuary_beneficiary","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","spouse_name","client_name","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every person whose name appears in the client''s free text — concerns, goals_notes or drafting_notes — also appears somewhere in the structured decisions. The name must be written in that free text to be in scope: a category such as \"descendants\", \"my children\" or \"issue\" names nobody. The direction is one-way. Free text → structured decisions, never the reverse. A person who appears in the structured decisions but not in the free text is not a finding and never was: a trustee, guardian or executor recorded in a slot and nowhere else is the ordinary case, not an omission. If you find yourself asking whether a name in a fiduciary slot appears in the concerns, you are auditing the wrong direction — stop, and answer the question in the first sentence. \"Appears in the structured decisions\" means any of them — a beneficiary field, a fiduciary field, spouse_name or client_name all count; a person need not be a beneficiary to be captured. Report only this: a person the client wrote by name whom the structured decisions never mention, who will therefore be absent from the drafted instrument with nobody noticing until it is signed. Whether the plan records a provision the concerns ask for — a residuary reflecting the client''s intent, for instance — is check 1''s finding and not this one, even when the fields it would live in are empty.","taskTemplate":{"title":"A person named in the notes is missing from the plan","description":"Someone is named in the design sheet''s free text but appears in none of the beneficiary or fiduciary fields. Confirm whether they were meant to be included.","priority":"high"}},{"number":"3","risk":"high","reads":["specific_bequests","assets"],"statement":"Every specific bequest names something the asset list contains. A bequest of property the client does not own, or no longer owns, adeems — the beneficiary takes nothing, and the gift the client believed they had made silently fails.","taskTemplate":{"title":"A specific bequest names an asset not on the list","description":"A specific bequest refers to property the asset list does not record. Confirm ownership before drafting, or the gift may adeem.","priority":"normal"}},{"number":"4","risk":"high","reads":["disinheritances","residuary_beneficiary","residual_beneficiary_individuals","concerns"],"statement":"Every disinheritance is deliberate on its face and consistent with the residuary. An omission that reads as accidental invites a pretermitted-heir claim under MUPC c. 190B § 2-302, and a person recorded as disinherited who nonetheless appears among the residuary beneficiaries is a contradiction the drafting cannot resolve.","taskTemplate":{"title":"A disinheritance is unclear or contradicted","description":"The disinheritance record either states no reason or conflicts with the residuary. Confirm the intent and make the omission explicit in the drafting.","priority":"normal"}},{"number":"5","risk":"blocker","reads":["spouse_citizenship","include_qdot","marital_trust_type"],"statement":"A spouse who is not a United States citizen has a QDOT, or a recorded decision not to use one. IRC § 2056(d) denies the unlimited marital deduction outright for a non-citizen spouse absent a qualified domestic trust, and the citizenship field is free text where ''green card'', ''permanent resident'' and ''not a citizen'' all appear and all mean the same thing here.","taskTemplate":{"title":"Non-citizen spouse with no QDOT decision","description":"The spouse appears not to be a US citizen and no QDOT decision is recorded. IRC 2056(d) denies the marital deduction without one.","priority":"high"}},{"number":"6","risk":"high","reads":["assets","real_property_transfer","state","client_domicile"],"statement":"Every parcel of real property recorded in the assets field has a transfer decision, and property outside Massachusetts has a plan for it. The asset list is the whole subject: if assets records no real property — including when it is empty — this check does not apply. Real property described only in the concerns or the notes is not a parcel in the asset list; that the sheet records no asset the concerns describe is check 1''s finding, not this one. Reporting it here cites two empty fields as though they were a parcel and its missing decision, which verifies and supports nothing. A trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier; and a Massachusetts trust alone does not avoid ancillary probate in the state where the other property sits.","taskTemplate":{"title":"Real property with no transfer decision","description":"The asset list records real property with no transfer decision, or property outside Massachusetts with no ancillary plan. Confirm how each parcel reaches the trust.","priority":"high"}}]}'::jsonb,
  '8bfd9f2654d0648600791d533982d31345c494a52f7eafc3ba091bf393b6c0a2',
  'A described asset is a stated concern: property with nothing directing where it goes is the gap check 1 exists to find. Owner''s ruling 2026-09-09.',
  'valid'
from public.prompts p
where p.slug = 'ma-design-sheet-audit'
on conflict (prompt_id, version_number) do nothing;

insert into public.prompt_publications (prompt_id, version_id)
select v.prompt_id, v.id
from public.prompt_versions v
join public.prompts p on p.id = v.prompt_id
where p.slug = 'ma-design-sheet-audit' and v.version_number = 8
on conflict (prompt_id) do update set version_id = excluded.version_id, published_at = now();

notify pgrst, 'reload schema';
