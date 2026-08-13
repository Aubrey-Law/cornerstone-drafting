-- Cornerstone — College Preparation Plan SLA v1.
--
-- CP matters were running the estate-planning checklist, which is the wrong
-- shape in both directions: it asks for a trust, deeds, funding, and a
-- Certification of Trust that this plan never produces, and it never asks the
-- two questions that actually govern a college plan —
--
--   1. Is the student eighteen yet? Nothing can be signed before the birthday.
--   2. When is move-in? That, not the firm's clock, is the real deadline.
--
-- Shorter than the estate SLA because the work is: five documents, one design
-- conversation, one signing, no funding. ~10 days pre-engagement, 14 after.
--
-- The pre-engagement tasks anchor to `discovery_call` only. There is no PMPS on
-- this track — the estate planning session exists to model estate tax, and a
-- student has no estate to model.
--
-- Nothing is gated on `fit_confirmed` either. On the estate track that gate
-- holds back a week of preparation until the attorney decides the lead is worth
-- it; here the next step after the call is a questionnaire, and making the firm
-- record a fit decision to release it costs more than it saves.
--
-- Drafted from the plan's document set and the firm's estate template; the task
-- list is a starting point for the attorney to adjust, not a firm commitment
-- anyone has signed off on.

insert into public.sla_task_templates (
  template_name, description, target_days, target_days_pre_engagement, target_days_engagement, tasks
)
values (
  'college_prep_sla_v1',
  'College Preparation Plan, inquiry to signing. Pre-engagement: ~10-day soft target anchored to the intro call. Post-engagement: 14-day firm SLA (design, drafting, review, signing), then delivery of copies to the student and the named agents. No trust, no funding, no deeds.',
  24, 10, 14,
  '[
    {"phase":"new_lead","name":"Parent or student books intro call","due_offset_days":null,"relative_to":null,"assignee":"client","pre_engagement":true},
    {"phase":"new_lead","name":"Hold intro call","due_offset_days":0,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},
    {"phase":"new_lead","name":"Confirm the student turns 18 before signing, and note the move-in / orientation date","due_offset_days":0,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},

    {"phase":"intake_sent","name":"Send College Preparation Plan questionnaire","due_offset_days":0,"relative_to":"discovery_call","assignee":"automation","auto":true,"pre_engagement":true},
    {"phase":"intake_sent","name":"Student completes the questionnaire","due_offset_days":5,"relative_to":"discovery_call","nudge_offset_days":3,"nudge_tier":"gentle","assignee":"client","pre_engagement":true},

    {"phase":"intake_completed","name":"Review answers; confirm the named agents are reachable","due_offset_days":6,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},

    {"phase":"engagement_sent","name":"Send engagement agreement","due_offset_days":7,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},
    {"phase":"engagement_sent","name":"Client signs engagement agreement","due_offset_days":10,"relative_to":"discovery_call","nudge_offset_days":8,"nudge_tier":"gentle","escalation_offset_days":12,"escalation_tier":"firm","assignee":"client","pre_engagement":true,"triggers_day_zero":true},

    {"phase":"intake","name":"Create matter folder in OneDrive","due_offset_days":0,"assignee":"automation","skill":"new-matter-folder","auto":true},
    {"phase":"intake","name":"Send invoice / collect payment","due_offset_days":0,"assignee":"attorney","skill":"qbo-invoice"},

    {"phase":"design","name":"Resolve the answers the student deferred to the meeting","due_offset_days":2,"assignee":"attorney"},
    {"phase":"design","name":"Confirm power of attorney scope and HIPAA recipients with the student","due_offset_days":3,"assignee":"attorney"},
    {"phase":"design","name":"Student approves the plan","due_offset_days":5,"nudge_offset_days":4,"nudge_tier":"gentle","assignee":"client","pauses_clock":true},

    {"phase":"drafting","name":"Draft the student package (POA, health care proxy, HIPAA, living will)","due_offset_days":7,"assignee":"attorney","skill":"draft-estate-plan-documents"},
    {"phase":"drafting","name":"Draft the FERPA release","due_offset_days":7,"assignee":"attorney","conditional":true},
    {"phase":"drafting","name":"Check whether the school requires its own FERPA form or portal authorization","due_offset_days":8,"assignee":"attorney","conditional":true},
    {"phase":"drafting","name":"Internal QA review of all documents","due_offset_days":9,"assignee":"attorney"},
    {"phase":"drafting","name":"Deliver drafts for review","due_offset_days":10,"nudge_offset_days":9,"nudge_tier":"internal","assignee":"attorney"},

    {"phase":"client_review","name":"Student reviews drafts and submits feedback","due_offset_days":12,"nudge_offset_days":11,"nudge_tier":"gentle","escalation_offset_days":13,"escalation_tier":"firm","assignee":"client","pauses_clock":true},

    {"phase":"revision","name":"Incorporate revisions","due_offset_days":13,"assignee":"attorney","conditional":true},
    {"phase":"revision","name":"Deliver revised drafts to the student","due_offset_days":13,"assignee":"attorney","conditional":true},

    {"phase":"signing_scheduled","name":"Confirm the student has turned 18 before scheduling","due_offset_days":12,"assignee":"attorney"},
    {"phase":"signing_scheduled","name":"Schedule signing ahead of the move-in / orientation date","due_offset_days":12,"assignee":"attorney"},
    {"phase":"signing_scheduled","name":"Print and tab all documents for signing","due_offset_days":13,"assignee":"attorney"},

    {"phase":"signing_complete","name":"Signing meeting held","due_offset_days":14,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Supervise execution (student, notary, witnesses)","due_offset_days":14,"assignee":"attorney"},

    {"phase":"post_execution","name":"Scan signed originals; upload to OneDrive","due_offset_days":15,"assignee":"attorney"},
    {"phase":"post_execution","name":"Give the student copies to carry (wallet card / phone)","due_offset_days":16,"assignee":"attorney"},
    {"phase":"post_execution","name":"Deliver copies to the named agents","due_offset_days":16,"assignee":"attorney"},
    {"phase":"post_execution","name":"Submit the FERPA release to the school","due_offset_days":17,"assignee":"attorney","conditional":true},
    {"phase":"post_execution","name":"Send the HIPAA authorization and health care proxy to the campus health center","due_offset_days":17,"assignee":"attorney","conditional":true},
    {"phase":"post_execution","name":"File legal plan claim if applicable (MetLife / LegalEASE / ARAG)","due_offset_days":20,"assignee":"attorney","skill":"metlife-claim","conditional":true},

    {"phase":"closed","name":"Confirm documents delivered; close matter","due_offset_days":null,"assignee":"attorney"}
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
