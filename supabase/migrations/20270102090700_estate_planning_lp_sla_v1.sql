-- Cornerstone — Estate Planning (Legal Plan) SLA v1.
--
-- EP-LP matters ran `estate_planning_sla_v3`, the private-pay checklist. Under a
-- legal plan (MetLife, LegalEASE, ARAG) the plan pays the firm, so that list asks
-- for the wrong things at both ends: an invoice at engagement and a balance at
-- signing the client never owes, and a plan claim filed only "if applicable" when
-- it is the whole of the firm's payment.
--
-- This starts as a copy of v3, with the same phases, offsets, anchors and clocks,
-- and four tasks changed:
--
--   Engaged          "Send invoice / collect payment" becomes confirming coverage
--                    and getting the case / authorization number. Plans want it
--                    before work starts, and the claim cannot be filed without it.
--   Ready to Sign    "Generate final invoice if balance due" becomes invoicing the
--                    client for out-of-plan work only (still conditional).
--   Signed           "Collect any balance due" becomes collecting for out-of-plan
--                    work only (still conditional).
--   Post-Signing     "File legal plan claim" is no longer conditional.
--
-- The two titles code matches on, "Client signs engagement agreement" and
-- "Signing meeting held", are unchanged. Edit this list in a later migration as
-- the firm revises the LP checklist (docs/operations/plan-tasks-review.md).

insert into public.sla_task_templates (
  template_name, description, target_days, target_days_pre_engagement, target_days_engagement, tasks
)
values (
  'estate_planning_lp_sla_v1',
  'Estate planning under a legal plan (MetLife / LegalEASE / ARAG), lead to signing. Same clocks as the private-pay estate SLA: ~14-day soft pre-engagement target, 28-day firm SLA from engagement. Coverage is confirmed at engagement instead of invoicing, and the plan claim is always filed.',
  42, 14, 28,
  '[
    {"phase":"new_lead","name":"Lead schedules 15-min discovery call","due_offset_days":null,"relative_to":null,"assignee":"client","pre_engagement":true},
    {"phase":"new_lead","name":"Hold discovery call","due_offset_days":0,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},
    {"phase":"new_lead","name":"Determine fit - proceed or decline","due_offset_days":0,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},

    {"phase":"intake_sent","name":"Send post-discovery email (PMPS link + estate plan organizer)","due_offset_days":0,"relative_to":"discovery_call","assignee":"automation","auto":true,"gate":"fit_confirmed","pre_engagement":true},
    {"phase":"intake_sent","name":"Lead schedules Peace of Mind Planning Session","due_offset_days":7,"relative_to":"discovery_call","nudge_offset_days":5,"nudge_tier":"gentle","assignee":"client","gate":"fit_confirmed","pre_engagement":true},
    {"phase":"intake_sent","name":"Lead completes estate plan organizer","due_offset_days":-1,"relative_to":"pmps","nudge_offset_days":-3,"nudge_tier":"gentle","assignee":"client","gate":"fit_confirmed","pre_engagement":true},

    {"phase":"intake_completed","name":"Confirm organizer submitted; follow up if not","due_offset_days":-1,"relative_to":"pmps","assignee":"attorney","pre_engagement":true},
    {"phase":"intake_completed","name":"Run PMPS prep (agenda, proposal, tax worksheet, one-pager)","due_offset_days":-1,"relative_to":"pmps","assignee":"attorney","skill":"pmps-prep","pre_engagement":true},
    {"phase":"intake_completed","name":"Hold Peace of Mind Planning Session","due_offset_days":0,"relative_to":"pmps","assignee":"attorney","pre_engagement":true},

    {"phase":"engagement_sent","name":"Send recommendations + engagement agreement","due_offset_days":1,"relative_to":"pmps","assignee":"attorney","pre_engagement":true},
    {"phase":"engagement_sent","name":"Client signs engagement agreement","due_offset_days":4,"relative_to":"pmps","nudge_offset_days":3,"nudge_tier":"gentle","escalation_offset_days":7,"escalation_tier":"firm","assignee":"client","pre_engagement":true,"triggers_day_zero":true},

    {"phase":"intake","name":"Create matter folder in OneDrive","due_offset_days":0,"assignee":"automation","skill":"new-matter-folder","auto":true},
    {"phase":"intake","name":"Confirm legal plan coverage and obtain the case / authorization number","due_offset_days":0,"assignee":"attorney"},

    {"phase":"design","name":"Send design summary to client","due_offset_days":1,"assignee":"attorney"},
    {"phase":"design","name":"Schedule optional design meeting","due_offset_days":2,"assignee":"attorney","conditional":true},
    {"phase":"design","name":"Hold design meeting","due_offset_days":5,"assignee":"attorney","conditional":true},
    {"phase":"design","name":"Client approves design","due_offset_days":7,"nudge_offset_days":5,"nudge_tier":"gentle","escalation_offset_days":10,"escalation_tier":"firm","assignee":"client","pauses_clock":true},

    {"phase":"drafting","name":"Draft full document package","due_offset_days":13,"nudge_offset_days":11,"nudge_tier":"internal","assignee":"attorney","skill":"draft-estate-plan-documents"},
    {"phase":"drafting","name":"Draft deed(s) if applicable","due_offset_days":14,"assignee":"attorney","skill":"deed-drafting","conditional":true},
    {"phase":"drafting","name":"Internal QA review of all documents","due_offset_days":15,"assignee":"attorney"},
    {"phase":"drafting","name":"Deliver drafts to client for review","due_offset_days":16,"nudge_offset_days":14,"nudge_tier":"internal","assignee":"attorney"},

    {"phase":"client_review","name":"Client reviews drafts and submits feedback","due_offset_days":22,"nudge_offset_days":20,"nudge_tier":"gentle","escalation_offset_days":24,"escalation_tier":"firm","assignee":"client","pauses_clock":true},

    {"phase":"revision","name":"Incorporate revisions (Round 1)","due_offset_days":24,"assignee":"attorney"},
    {"phase":"revision","name":"Deliver revised drafts to client","due_offset_days":24,"assignee":"attorney"},
    {"phase":"revision","name":"Round 2 revision (extends SLA +5 days)","due_offset_days":29,"assignee":"attorney","conditional":true,"extends_target_days":5},

    {"phase":"signing_scheduled","name":"Indicate funding details for each asset in design sheet","due_offset_days":25,"assignee":"attorney"},
    {"phase":"signing_scheduled","name":"Print and tab all documents for signing","due_offset_days":27,"assignee":"attorney"},
    {"phase":"signing_scheduled","name":"Invoice the client for any out-of-plan work","due_offset_days":27,"assignee":"attorney","skill":"cornerstone-billing","conditional":true},
    {"phase":"signing_scheduled","name":"Generate DIY signing instructions","due_offset_days":25,"assignee":"attorney","conditional":true,"variant":"remote_signing"},
    {"phase":"signing_scheduled","name":"Mail/deliver signing package to client","due_offset_days":25,"assignee":"attorney","conditional":true,"variant":"remote_signing"},
    {"phase":"signing_scheduled","name":"Confirm client received package","due_offset_days":28,"assignee":"attorney","conditional":true,"variant":"remote_signing","pauses_clock":true},
    {"phase":"signing_scheduled","name":"Monitor signing progress until originals returned","due_offset_days":28,"nudge_offset_days":28,"nudge_tier":"gentle","assignee":"attorney","conditional":true,"variant":"remote_signing","pauses_clock":true,"recurring_interval_days":7},

    {"phase":"signing_complete","name":"Signing meeting held","due_offset_days":28,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Supervise execution (clients, notary, witnesses)","due_offset_days":28,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Collect payment for any out-of-plan work","due_offset_days":28,"assignee":"attorney","conditional":true},
    {"phase":"signing_complete","name":"Scan signed Certification of Trust; upload to OneDrive","due_offset_days":28,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Review trust funding package with client","due_offset_days":28,"assignee":"attorney","skill":"trust-funding"},
    {"phase":"signing_complete","name":"Originals received; proceed to post-signing","due_offset_days":35,"assignee":"attorney","conditional":true,"variant":"remote_signing"},

    {"phase":"post_execution","name":"Send deeds to county clerk for recording","due_offset_days":29,"assignee":"attorney","conditional":true},
    {"phase":"post_execution","name":"Scan all signed originals; upload to OneDrive","due_offset_days":31,"assignee":"attorney"},
    {"phase":"post_execution","name":"Generate estate plan summary","due_offset_days":33,"assignee":"attorney","skill":"generate-estate-plan-summary"},
    {"phase":"post_execution","name":"Draft closing / funding package","due_offset_days":34,"assignee":"attorney","skill":"trust-funding"},
    {"phase":"post_execution","name":"Deliver closing package to client","due_offset_days":35,"assignee":"attorney"},
    {"phase":"post_execution","name":"Send handwritten thank-you note","due_offset_days":35,"assignee":"attorney"},
    {"phase":"post_execution","name":"File legal plan claim (MetLife / LegalEASE / ARAG)","due_offset_days":38,"assignee":"attorney","skill":"metlife-claim"},

    {"phase":"funding","name":"30-day post-signing funding check-in","due_offset_days":58,"nudge_offset_days":58,"nudge_tier":"gentle","assignee":"attorney","recurring_interval_days":30},
    {"phase":"funding","name":"Confirm recorded deeds received from county","due_offset_days":58,"assignee":"attorney","conditional":true},
    {"phase":"funding","name":"Confirm all assets funded; close matter","due_offset_days":null,"assignee":"attorney"}
  ]'::jsonb
)
on conflict (template_name) do update set
  description                = excluded.description,
  target_days                = excluded.target_days,
  target_days_pre_engagement = excluded.target_days_pre_engagement,
  target_days_engagement     = excluded.target_days_engagement,
  tasks                      = excluded.tasks,
  updated_at                 = now();

notify pgrst, 'reload schema';
