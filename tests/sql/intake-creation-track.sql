-- Run after intake-form-pinning.sql in the disposable database harness.
INSERT INTO public.intake_form_versions (id,template_id,version,status,definition,definition_hash,created_by,published_by,published_at)
VALUES ('30000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002',5,'published','{}',repeat('b',64),'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now());
DO $$
DECLARE area text; result public.client_intake%ROWTYPE;
BEGIN
  FOREACH area IN ARRAY ARRAY['CP','cp',' CP ','College Preparation Plan','College Prep','College Prep Plan'] LOOP
    INSERT INTO public.client_intake(id,practice_area) VALUES ('area_' || area,area) RETURNING * INTO result;
    PERFORM public.assert_pin_test(result.intake_track='college_prep' AND result.form_version_id='30000000-0000-0000-0000-000000000005', 'CP track selected before pin: ' || area);
  END LOOP;
  FOREACH area IN ARRAY ARRAY['EP','EP-LP','Probate','TA','Estate Planning','unknown'] LOOP
    INSERT INTO public.client_intake(id,practice_area,intake_track) VALUES ('area_' || area,area,'college_prep') RETURNING * INTO result;
    PERFORM public.assert_pin_test(result.intake_track='estate' AND result.form_version_id='30000000-0000-0000-0000-000000000001', 'practice area authoritative for new intake: ' || area);
  END LOOP;
END; $$;
INSERT INTO public.client_intake(id,intake_track) VALUES ('explicit_college','college_prep');
SELECT public.assert_pin_test((SELECT intake_track='college_prep' AND form_version_id='30000000-0000-0000-0000-000000000005' FROM public.client_intake WHERE id='explicit_college'), 'explicit track retained without practice area');
INSERT INTO public.client_intake(id) VALUES ('context_free');
SELECT public.assert_pin_test((SELECT intake_track='estate' FROM public.client_intake WHERE id='context_free'), 'context-free estate default');
-- Matter/lead reclassification and repeated imports must not change old pins.
UPDATE public.client_intake SET practice_area='EP' WHERE id='area_CP';
SELECT public.assert_pin_test((SELECT intake_track='college_prep' AND form_version_id='30000000-0000-0000-0000-000000000005' FROM public.client_intake WHERE id='area_CP'), 'updates preserve original questionnaire');
INSERT INTO public.client_intake(id,practice_area) VALUES ('area_CP','EP')
ON CONFLICT(id) DO UPDATE SET practice_area=EXCLUDED.practice_area;
SELECT public.assert_pin_test((SELECT intake_track='college_prep' FROM public.client_intake WHERE id='area_CP'), 'upsert update preserves original track');
UPDATE intake_private.form_pinning_rollout SET enabled=false;
INSERT INTO public.client_intake(id,practice_area) VALUES ('disabled_cp','CP');
SELECT public.assert_pin_test((SELECT intake_track='college_prep' AND form_version_id IS NULL FROM public.client_intake WHERE id='disabled_cp'), 'track selection also works before rollout');
UPDATE intake_private.form_pinning_rollout SET enabled=true;
SET ROLE authenticated;
INSERT INTO public.client_intake(id,practice_area) VALUES ('authorized_cp','CP');
RESET ROLE;
SELECT public.assert_pin_test((SELECT intake_track='college_prep' AND form_version_id='30000000-0000-0000-0000-000000000005' FROM public.client_intake WHERE id='authorized_cp'), 'authorized insert can execute both private triggers');
