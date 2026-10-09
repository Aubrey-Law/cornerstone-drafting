SET request.jwt.claim.role='service_role';
DO $$
DECLARE
  c record; wi uuid; li uuid; wm uuid; lm uuid;
  pin_a uuid := gen_random_uuid(); pin_b uuid := gen_random_uuid();
  rejected boolean; message text; output jsonb;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('legacy same track',false,false,false,false,false,false,false),
    ('legacy different tracks',false,false,false,false,false,true,true),
    ('pinned versus legacy',true,false,false,false,false,false,true),
    ('legacy versus pinned',false,true,false,false,false,false,true),
    ('same version separate answers',true,true,false,false,false,false,true),
    ('different versions',true,true,false,false,true,false,true),
    ('shared pinned intake',true,true,true,false,false,false,false),
    ('pinned versus absent',true,false,false,true,false,false,true),
    ('legacy versus absent',false,false,false,true,false,false,false)
  ) AS cases(label, wp, lp, shared, absent, different_version, different_track, refuse) LOOP
    wi:=gen_random_uuid(); li:=gen_random_uuid(); wm:=gen_random_uuid(); lm:=gen_random_uuid();
    INSERT INTO public.client_intake VALUES(wi,'estate',CASE WHEN c.wp THEN pin_a END,'{"answer":"winner"}');
    IF c.shared THEN li:=wi;
    ELSIF c.absent THEN li:=NULL;
    ELSE INSERT INTO public.client_intake VALUES(li,CASE WHEN c.different_track THEN 'college_prep' ELSE 'estate' END,CASE WHEN c.lp THEN CASE WHEN c.different_version THEN pin_b ELSE pin_a END END,'{"answer":"loser"}');
    END IF;
    INSERT INTO public.matters(id,client_intake_id,status) VALUES(wm,wi,'active'),(lm,li,'active');
    INSERT INTO public.matter_documents(matter_id) VALUES(lm::text);
    INSERT INTO public.design_sheets(matter_id) VALUES(lm);
    INSERT INTO public.contact_roles(id,matter_id) VALUES(gen_random_uuid(),lm);
    IF li IS NOT NULL THEN INSERT INTO public.intake_uploads(client_intake_id) VALUES(li); END IF;
    rejected:=false;
    BEGIN
      output:=public.merge_matters(wm,lm);
    EXCEPTION WHEN SQLSTATE '22023' THEN rejected:=true; message:=SQLERRM;
    END;
    IF rejected IS DISTINCT FROM c.refuse THEN RAISE EXCEPTION 'Unexpected merge outcome: % (%)',c.label,message; END IF;
    IF c.refuse THEN
      IF EXISTS(SELECT 1 FROM public.matters WHERE id=lm AND (merged_into_id IS NOT NULL OR status<>'active'))
        OR EXISTS(SELECT 1 FROM public.matter_merges WHERE loser_matter_id=lm)
        OR EXISTS(SELECT 1 FROM public.matter_activity WHERE matter_id=wm::text)
        OR NOT EXISTS(SELECT 1 FROM public.matter_documents WHERE matter_id=lm::text)
        OR NOT EXISTS(SELECT 1 FROM public.design_sheets WHERE matter_id=lm)
        OR NOT EXISTS(SELECT 1 FROM public.contact_roles WHERE matter_id=lm)
        OR (li IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.intake_uploads WHERE client_intake_id=li))
      THEN RAISE EXCEPTION 'Rejected merge changed data: %',c.label; END IF;
    ELSE
      IF NOT EXISTS(SELECT 1 FROM public.matters WHERE id=lm AND merged_into_id=wm AND status='archived')
        OR NOT EXISTS(SELECT 1 FROM public.matter_merges WHERE loser_matter_id=lm)
        OR NOT EXISTS(SELECT 1 FROM public.matter_documents WHERE matter_id=wm::text)
      THEN RAISE EXCEPTION 'Allowed merge failed existing behavior: %',c.label; END IF;
    END IF;
    IF (SELECT answers->>'answer' FROM public.client_intake WHERE id=wi) <> 'winner' THEN RAISE EXCEPTION 'Winner answers changed'; END IF;
    IF li IS NOT NULL AND li <> wi AND (SELECT answers->>'answer' FROM public.client_intake WHERE id=li) <> 'loser' THEN RAISE EXCEPTION 'Other intake answers changed'; END IF;
  END LOOP;
  -- Missing referenced intake is never silently treated as an unpinned one.
  wm:=gen_random_uuid(); lm:=gen_random_uuid();
  INSERT INTO public.matters(id,client_intake_id,status) VALUES(wm,gen_random_uuid(),'active'),(lm,NULL,'active');
  BEGIN
    PERFORM public.merge_matters(wm,lm);
    RAISE EXCEPTION 'Missing intake accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END; $$;
RESET request.jwt.claim.role;
DO $$ BEGIN
  PERFORM public.merge_matters(gen_random_uuid(),gen_random_uuid());
  RAISE EXCEPTION 'Missing service role accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END; $$;
