-- The design-sheet audit produces one checklist instead of six tasks.
--
-- outputTarget lives in the body rather than on `prompts` because a run
-- records only its prompt_version_id: as a mutable column, a run from last
-- week would be indistinguishable from one that produced something else
-- entirely. The rule that falls out is that content changes make a version and
-- configuration does not -- fires_on_stage_entry decides *when* a prompt runs
-- and is a column, outputTarget decides *what a run produces* and is content.
-- So this is version 4, and versions 1 to 3 stay interpretable against exactly
-- what they produced.
--
-- Checks 1 and 2 both flag one guardian gap from different angles, and
-- version 3 accepted that overlap deliberately rather than build a
-- finding-suppresses-finding pass for a six-check prompt. As a checklist those
-- two become two items on one task. The duplication is still there; what is
-- gone is its cost in an attorney's task list.
--
-- The body is version 3's byte for byte, with one field added. Generated
-- rather than retyped, and the content_hash is sha256 of the JSON with SQL's
-- doubled single quotes collapsed back -- checked against version 3, whose
-- stated hash matches that form and not the raw literal.
--
-- The prompt is found by slug rather than by a hard-coded id: an earlier
-- migration in this series pasted an id lifted by pattern and got the
-- version's id instead of the prompt's.

insert into public.prompt_versions (
  prompt_id, kind, version_number, body, content_hash, change_summary, validation_status
)
select
  p.id,
  'field_audit',
  4,
  '{"kind":"field_audit","outputTarget":"checklist","inputs":[{"key":"concerns","source":"design_sheet.concerns","required":true},{"key":"goals_notes","source":"design_sheet.goals_notes","required":false},{"key":"drafting_notes","source":"design_sheet.drafting_notes","required":false},{"key":"children","source":"design_sheet.children","required":false},{"key":"assets","source":"design_sheet.assets","required":false},{"key":"specific_bequests","source":"design_sheet.specific_bequests","required":false},{"key":"disinheritances","source":"design_sheet.disinheritances","required":false},{"key":"residuary_beneficiary","source":"design_sheet.residuary_beneficiary","required":false},{"key":"residual_beneficiary_individuals","source":"design_sheet.residual_beneficiary_individuals","required":false},{"key":"residuary_distribution","source":"design_sheet.residuary_distribution","required":false},{"key":"spouse_citizenship","source":"design_sheet.spouse_citizenship","required":false},{"key":"include_qdot","source":"design_sheet.include_qdot","required":false},{"key":"marital_trust_type","source":"design_sheet.marital_trust_type","required":false},{"key":"real_property_transfer","source":"design_sheet.real_property_transfer","required":false},{"key":"state","source":"design_sheet.state","required":false},{"key":"client_domicile","source":"design_sheet.client_domicile","required":false},{"key":"guardian_primary","source":"design_sheet.guardian_primary","required":false},{"key":"guardian_alt1","source":"design_sheet.guardian_alt1","required":false},{"key":"trustee_primary","source":"design_sheet.trustee_primary","required":false},{"key":"trustee_alt1","source":"design_sheet.trustee_alt1","required":false},{"key":"executor_primary","source":"design_sheet.executor_primary","required":false},{"key":"hcp_primary","source":"design_sheet.hcp_primary","required":false},{"key":"poa_primary","source":"design_sheet.poa_primary","required":false},{"key":"spouse_name","source":"design_sheet.spouse_name","required":false},{"key":"client_name","source":"design_sheet.client_name","required":false},{"key":"guardian_slots","source":"design_sheet.guardian_slots","required":false},{"key":"temporary_guardian_slots","source":"design_sheet.temporary_guardian_slots","required":false},{"key":"trustee_slots","source":"design_sheet.trustee_slots","required":false},{"key":"executor_slots","source":"design_sheet.executor_slots","required":false},{"key":"hcp_slots","source":"design_sheet.hcp_slots","required":false},{"key":"poa_slots","source":"design_sheet.poa_slots","required":false}],"checks":[{"number":"1","risk":"blocker","reads":["concerns","goals_notes","residuary_beneficiary","residual_beneficiary_individuals","residuary_distribution","marital_trust_type","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every concern the client stated has a provision in the plan responsive to it — a residuary that reflects it, a trust type that accommodates it, a fiduciary appointed to carry it out. Report the substance only: whether the plan does the thing the concern asks for. A person named in the concerns who appears nowhere in the structured decisions is check 2''s finding and not this one; reporting it here as well raises two blockers for one gap, and an attorney reading a list of two learns less than one who reads a list of one.","taskTemplate":{"title":"A stated concern is not answered by the plan","description":"The design sheet records a concern the plan makes no provision for. Confirm whether the plan should change or the concern is answered elsewhere. If the concern is that a named person is missing, that is a separate finding.","priority":"high"}},{"number":"2","risk":"blocker","reads":["concerns","goals_notes","drafting_notes","children","residual_beneficiary_individuals","residuary_beneficiary","guardian_primary","guardian_alt1","trustee_primary","trustee_alt1","executor_primary","hcp_primary","poa_primary","spouse_name","client_name","guardian_slots","temporary_guardian_slots","trustee_slots","executor_slots","hcp_slots","poa_slots"],"statement":"Every person named in the client''s free text appears in the structured decisions. A child or intended beneficiary who is mentioned by name in the concerns or notes but appears in no beneficiary or fiduciary field will be absent from the drafted instrument, and nobody will notice until it is signed.","taskTemplate":{"title":"A person named in the notes is missing from the plan","description":"Someone is named in the design sheet''s free text but appears in none of the beneficiary or fiduciary fields. Confirm whether they were meant to be included.","priority":"high"}},{"number":"3","risk":"high","reads":["specific_bequests","assets"],"statement":"Every specific bequest names something the asset list contains. A bequest of property the client does not own, or no longer owns, adeems — the beneficiary takes nothing, and the gift the client believed they had made silently fails.","taskTemplate":{"title":"A specific bequest names an asset not on the list","description":"A specific bequest refers to property the asset list does not record. Confirm ownership before drafting, or the gift may adeem.","priority":"normal"}},{"number":"4","risk":"high","reads":["disinheritances","residuary_beneficiary","residual_beneficiary_individuals","concerns"],"statement":"Every disinheritance is deliberate on its face and consistent with the residuary. An omission that reads as accidental invites a pretermitted-heir claim under MUPC c. 190B § 2-302, and a person recorded as disinherited who nonetheless appears among the residuary beneficiaries is a contradiction the drafting cannot resolve.","taskTemplate":{"title":"A disinheritance is unclear or contradicted","description":"The disinheritance record either states no reason or conflicts with the residuary. Confirm the intent and make the omission explicit in the drafting.","priority":"normal"}},{"number":"5","risk":"blocker","reads":["spouse_citizenship","include_qdot","marital_trust_type"],"statement":"A spouse who is not a United States citizen has a QDOT, or a recorded decision not to use one. IRC § 2056(d) denies the unlimited marital deduction outright for a non-citizen spouse absent a qualified domestic trust, and the citizenship field is free text where ''green card'', ''permanent resident'' and ''not a citizen'' all appear and all mean the same thing here.","taskTemplate":{"title":"Non-citizen spouse with no QDOT decision","description":"The spouse appears not to be a US citizen and no QDOT decision is recorded. IRC 2056(d) denies the marital deduction without one.","priority":"high"}},{"number":"6","risk":"high","reads":["assets","real_property_transfer","state","client_domicile"],"statement":"Every parcel of real property in the asset list has a transfer decision, and property outside Massachusetts has a plan for it. A trust that does not hold the house is the failure the funding tracker exists to catch, one stage earlier; and a Massachusetts trust alone does not avoid ancillary probate in the state where the other property sits.","taskTemplate":{"title":"Real property with no transfer decision","description":"The asset list records real property with no transfer decision, or property outside Massachusetts with no ancillary plan. Confirm how each parcel reaches the trust.","priority":"high"}}]}'::jsonb,
  '0b4cbffd27efcb514047092a0c51d7999cb1e0e0c4b4bd117ec5228a269fa692',
  'The audit produces one checklist task with an item per finding, instead of one task per finding.',
  'valid'
from public.prompts p
where p.slug = 'ma-design-sheet-audit'
on conflict (prompt_id, version_number) do nothing;

-- `do update`, not `do nothing`: a publication row already exists from the
-- earlier versions, and leaving it pinned there would publish nothing at all.
insert into public.prompt_publications (prompt_id, version_id)
select v.prompt_id, v.id
from public.prompt_versions v
join public.prompts p on p.id = v.prompt_id
where p.slug = 'ma-design-sheet-audit' and v.version_number = 4
on conflict (prompt_id) do update
  set version_id = excluded.version_id,
      published_at = now();

notify pgrst, 'reload schema';
