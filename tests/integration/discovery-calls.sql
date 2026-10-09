-- Run with psql -v ON_ERROR_STOP=1 against an isolated local schema with migrations applied.
-- Supply definition/hash psql variables from lib/discovery/definition.ts and its canonical hash.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin@discovery.test'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','client@discovery.test');
INSERT INTO public.users(id,role) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','client');
INSERT INTO public.client_intake(id,first_name,last_name,email,lead_status,status) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Test','Caller','discovery@example.test','lead','in_progress');
INSERT INTO public.matters(id,client_intake_id,name,stage,relationship_status) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Test Caller','new_lead','lead');
UPDATE public.client_intake SET matter_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
INSERT INTO public.cornerstone_crm_stages(name,slug) VALUES('New inquiry','new_inquiry') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.create_intake_form_template('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','internal_discovery_call','Discovery',NULL,:'definition'::jsonb,:'hash')->>'id' AS version_id \gset
SELECT public.publish_intake_form_draft('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',:'version_id',0,:'hash');
SELECT set_config('discovery.test_version',:'version_id',true);
DO $$
DECLARE c jsonb; again jsonb; completed jsonb; lead uuid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; actor uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; v uuid=current_setting('discovery.test_version')::uuid; count_events int; old_anchor timestamptz;
BEGIN
 IF (SELECT purpose FROM public.intake_form_templates WHERE key='internal_discovery_call') <> 'discovery_call' THEN RAISE EXCEPTION 'purpose was not captured'; END IF;
 c:=public.discovery_call_write(lead,actor,'start',p_version_id=>v);
 again:=public.discovery_call_write(lead,actor,'start',p_version_id=>v);
 IF c->>'id' <> again->>'id' THEN RAISE EXCEPTION 'duplicate draft'; END IF;
 c:=public.discovery_call_write(lead,actor,'save',(c->>'id')::uuid,0,'{"discovery_prompt":"private","discovery_minor_children":"unknown","discovery_household":null}'::jsonb);
 IF c->'answers'->>'discovery_minor_children' <> 'unknown' OR c->'answers'->'discovery_household' <> 'null'::jsonb THEN RAISE EXCEPTION 'round trip failed'; END IF;
 BEGIN
  PERFORM public.discovery_call_write(lead,actor,'save',(c->>'id')::uuid,0,'{}'); RAISE EXCEPTION 'stale save accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.discovery_call_write(lead,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','save',(c->>'id')::uuid,1,'{}'); RAISE EXCEPTION 'client actor accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT discovery_call_at INTO old_anchor FROM public.matters WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 completed:=public.discovery_call_write(lead,actor,'complete',(c->>'id')::uuid,1,'{"discovery_call_at":"2026-10-09T10:00","discovery_outcome":"proceed","discovery_next_action":"send_organizer"}','Internal summary');
 again:=public.discovery_call_write(lead,actor,'complete',(c->>'id')::uuid,1,'{}','Retry');
 IF again <> completed THEN RAISE EXCEPTION 'completion retry not idempotent'; END IF;
 SELECT count(*) INTO count_events FROM public.lead_activity WHERE lead_id=lead AND event_type='discovery_call_completed';
 IF count_events<>1 THEN RAISE EXCEPTION 'duplicate activity'; END IF;
 IF (SELECT discovery_call_at FROM public.matters WHERE id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') IS DISTINCT FROM old_anchor THEN RAISE EXCEPTION 'anchor changed'; END IF;
 PERFORM public.discovery_call_write(lead,actor,'amend',(c->>'id')::uuid,p_amendment=>'Correction');
 IF (SELECT count(*) FROM public.discovery_call_amendments WHERE call_id=(c->>'id')::uuid)<>1 THEN RAISE EXCEPTION 'missing amendment'; END IF;
 PERFORM public.apply_discovery_facts(lead,(c->>'id')::uuid,actor,'[{"field":"firstName","expected":"Test","value":"Reviewed"}]');
 IF (SELECT first_name FROM public.client_intake WHERE id=lead)<>'Reviewed' THEN RAISE EXCEPTION 'canonical handoff failed'; END IF;
 BEGIN
  PERFORM public.apply_discovery_facts(lead,(c->>'id')::uuid,actor,'[{"field":"firstName","expected":"Test","value":"Overwrite"}]'); RAISE EXCEPTION 'stale fact overwrite accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 IF (SELECT first_name FROM public.client_intake WHERE id=lead)<>'Reviewed' THEN RAISE EXCEPTION 'conflict changed data'; END IF;
 PERFORM public.retire_intake_form_version(actor,v);
 IF NOT EXISTS(SELECT 1 FROM public.discovery_calls WHERE id=(c->>'id')::uuid AND form_version_id=v) THEN RAISE EXCEPTION 'pin lost after retirement'; END IF;
 IF has_table_privilege('anon','public.discovery_calls','SELECT') OR has_table_privilege('authenticated','public.discovery_calls','SELECT') OR has_table_privilege('authenticated','public.discovery_call_amendments','SELECT') THEN RAISE EXCEPTION 'internal data exposed'; END IF;
 IF has_function_privilege('authenticated','public.discovery_call_write(uuid,uuid,text,uuid,integer,jsonb,text,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'RPC exposed'; END IF;
 RAISE NOTICE 'PASS: resume, roundtrip, conflict, staff gate, atomic completion, retry, amendments, canonical handoff, retirement, privacy';
END $$;
ROLLBACK;
