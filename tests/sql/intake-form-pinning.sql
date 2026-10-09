-- Run only through scripts/testIntakeFormPinning.mjs in its isolated database.
INSERT INTO public.users (id, role) VALUES ('10000000-0000-0000-0000-000000000001', 'admin');
INSERT INTO public.intake_form_templates (id, key, name, created_by) VALUES
 ('20000000-0000-0000-0000-000000000001', 'estate', 'Estate', '10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002', 'college_prep', 'College', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.intake_form_versions (id, template_id, version, status, definition, definition_hash, created_by, published_by, published_at)
SELECT ('30000000-0000-0000-0000-00000000000' || n)::uuid,
  CASE WHEN n = 4 THEN '20000000-0000-0000-0000-000000000002'::uuid ELSE '20000000-0000-0000-0000-000000000001'::uuid END,
  n, CASE WHEN n = 3 THEN 'draft' ELSE 'published' END, '{}', repeat('a', 64),
  '10000000-0000-0000-0000-000000000001',
  CASE WHEN n = 3 THEN NULL ELSE '10000000-0000-0000-0000-000000000001'::uuid END,
  CASE WHEN n = 3 THEN NULL ELSE now() END FROM generate_series(1,4) n;

CREATE FUNCTION public.assert_pin_test(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', message; END IF; END; $$;
CREATE FUNCTION public.expect_pin_error(statement text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF position(fragment in SQLERRM) = 0 THEN RAISE; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected rejection: %', statement;
END; $$;

INSERT INTO public.client_intake (id) VALUES ('legacy');
SELECT public.assert_pin_test((SELECT form_version_id IS NULL FROM public.client_intake WHERE id='legacy'), 'rollout off remains legacy');
UPDATE intake_private.form_pinning_rollout SET enabled=true;
UPDATE public.intake_form_templates SET purpose='client_form' WHERE key='estate';
SELECT public.expect_pin_error($s$INSERT INTO public.client_intake(id) VALUES ('wrong_purpose')$s$, 'No published questionnaire');
UPDATE public.intake_form_templates SET purpose='client_intake' WHERE key='estate';
INSERT INTO public.client_intake (id) VALUES ('estate');
INSERT INTO public.client_intake (id, intake_track) VALUES ('college', 'college_prep');
SELECT public.assert_pin_test((SELECT form_version_id='30000000-0000-0000-0000-000000000002' FROM public.client_intake WHERE id='estate'), 'newest published, not draft');
SELECT public.assert_pin_test((SELECT form_version_id='30000000-0000-0000-0000-000000000004' FROM public.client_intake WHERE id='college'), 'track selection');
UPDATE public.client_intake SET answers='{"saved":"answer"}' WHERE id='estate';
UPDATE public.client_intake SET intake_track='college_prep' WHERE id='legacy';
SELECT public.assert_pin_test((SELECT form_version_id IS NULL FROM public.client_intake WHERE id='legacy'), 'updates do not backfill legacy pins');
SELECT public.expect_pin_error($s$UPDATE public.client_intake SET form_version_id=NULL WHERE id='estate'$s$, 'cannot be changed');
SELECT public.expect_pin_error($s$UPDATE public.client_intake SET form_version_id='30000000-0000-0000-0000-000000000001' WHERE id='estate'$s$, 'cannot be changed');
SELECT public.expect_pin_error($s$UPDATE public.client_intake SET form_version_id='30000000-0000-0000-0000-000000000004' WHERE id='legacy'$s$, 'cannot be changed');
SELECT public.expect_pin_error($s$UPDATE public.client_intake SET intake_track='college_prep' WHERE id='estate'$s$, 'track cannot be changed');
SELECT public.expect_pin_error($s$INSERT INTO public.client_intake(id,form_version_id) VALUES ('tampered','30000000-0000-0000-0000-000000000001')$s$, 'assigned by the database');
UPDATE public.intake_form_versions SET status='retired' WHERE id='30000000-0000-0000-0000-000000000002';
INSERT INTO public.client_intake (id) VALUES ('after_retire');
SELECT public.assert_pin_test((SELECT form_version_id='30000000-0000-0000-0000-000000000001' FROM public.client_intake WHERE id='after_retire'), 'retirement affects new rows only');
SELECT public.assert_pin_test((SELECT form_version_id='30000000-0000-0000-0000-000000000002' AND answers->>'saved'='answer' FROM public.client_intake WHERE id='estate'), 'retired pin and answers preserved');
UPDATE public.intake_form_templates SET archived_at=now() WHERE key='estate';
SELECT public.expect_pin_error($s$INSERT INTO public.client_intake(id) VALUES ('archived')$s$, 'No published questionnaire');
UPDATE public.client_intake SET answers='{"still":"editable"}' WHERE id='estate';
UPDATE public.intake_form_templates SET archived_at=NULL WHERE key='estate';
UPDATE public.intake_form_versions SET status='retired' WHERE id='30000000-0000-0000-0000-000000000004';
SELECT public.expect_pin_error($s$INSERT INTO public.client_intake(id,intake_track) VALUES ('missing','college_prep')$s$, 'No published questionnaire');
UPDATE intake_private.form_pinning_rollout SET enabled=false;
INSERT INTO public.client_intake (id, intake_track) VALUES ('rollback', 'college_prep');
SELECT public.assert_pin_test((SELECT form_version_id IS NULL FROM public.client_intake WHERE id='rollback'), 'rollback permits new legacy rows');
SELECT public.expect_pin_error($s$UPDATE public.client_intake SET form_version_id=NULL WHERE id='estate'$s$, 'cannot be changed');
SELECT public.assert_pin_test(NOT has_schema_privilege('authenticated','intake_private','USAGE'), 'private config not accessible');
SELECT public.assert_pin_test(NOT has_table_privilege('service_role','intake_private.form_pinning_rollout','UPDATE'), 'service API cannot activate rollout');
SELECT public.assert_pin_test(NOT has_function_privilege('anon','intake_private.guard_intake_form_pin()','EXECUTE'), 'no public trigger RPC');
UPDATE intake_private.form_pinning_rollout SET enabled=true;

-- The privileged trigger lookup does not require exposing its private schema
-- to a role allowed to insert into the intake table itself.
GRANT INSERT ON public.client_intake TO authenticated;
SET ROLE authenticated;
INSERT INTO public.client_intake (id) VALUES ('authorized_insert');
RESET ROLE;
SELECT public.assert_pin_test((SELECT form_version_id IS NOT NULL FROM public.client_intake WHERE id='authorized_insert'), 'trigger lookup works without catalog access');
INSERT INTO public.client_intake (id, answers) VALUES ('estate', '{"upsert":"answer"}')
  ON CONFLICT (id) DO UPDATE SET answers=EXCLUDED.answers;
SELECT public.assert_pin_test((SELECT form_version_id='30000000-0000-0000-0000-000000000002' AND answers->>'upsert'='answer' FROM public.client_intake WHERE id='estate'), 'answer-only upsert retains original retired pin');
