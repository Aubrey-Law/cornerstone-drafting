-- Ordered after the existing builder foundation and audit migrations.
ALTER TABLE public.intake_form_templates ADD COLUMN purpose text NOT NULL DEFAULT 'client_intake'
  CHECK (purpose IN ('client_intake', 'discovery_call'));
CREATE FUNCTION public.guard_form_purpose() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'intake_form_templates' THEN
    IF NEW.purpose IS DISTINCT FROM OLD.purpose AND EXISTS (SELECT 1 FROM public.intake_form_versions WHERE template_id = OLD.id) THEN
      RAISE EXCEPTION 'Form purpose is immutable' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM public.intake_form_versions WHERE template_id = NEW.template_id) THEN
      UPDATE public.intake_form_templates SET purpose = coalesce(NEW.definition->>'purpose', 'client_intake') WHERE id = NEW.template_id;
    END IF;
    IF coalesce(NEW.definition->>'purpose', 'client_intake') IS DISTINCT FROM (SELECT purpose FROM public.intake_form_templates WHERE id = NEW.template_id) THEN
      RAISE EXCEPTION 'Form purpose is immutable' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER intake_template_purpose BEFORE UPDATE ON public.intake_form_templates FOR EACH ROW EXECUTE FUNCTION public.guard_form_purpose();
CREATE TRIGGER intake_version_purpose BEFORE INSERT OR UPDATE ON public.intake_form_versions FOR EACH ROW EXECUTE FUNCTION public.guard_form_purpose();

CREATE TABLE public.discovery_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.client_intake(id) ON DELETE CASCADE,
  form_version_id uuid NOT NULL REFERENCES public.intake_form_versions(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  answers jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(answers) = 'object'),
  revision integer NOT NULL DEFAULT 0,
  summary text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  activity_id uuid REFERENCES public.lead_activity(id),
  CHECK ((status = 'draft' AND completed_at IS NULL AND activity_id IS NULL) OR (status = 'completed' AND completed_at IS NOT NULL AND activity_id IS NOT NULL))
);
CREATE UNIQUE INDEX discovery_one_draft ON public.discovery_calls(lead_id) WHERE status = 'draft';
CREATE INDEX discovery_lead_history ON public.discovery_calls(lead_id, created_at DESC);
CREATE TABLE public.discovery_call_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.discovery_calls(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.discovery_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_call_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovery_calls, public.discovery_call_amendments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.discovery_calls, public.discovery_call_amendments TO service_role;

CREATE FUNCTION public.discovery_call_write(p_lead_id uuid, p_actor_id uuid, p_operation text, p_call_id uuid DEFAULT NULL, p_revision integer DEFAULT NULL, p_answers jsonb DEFAULT '{}', p_summary text DEFAULT NULL, p_version_id uuid DEFAULT NULL, p_amendment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.discovery_calls; a uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND role IN ('attorney','admin')) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
  -- Serialize starts and all writers on the same opportunity, including canonical edits.
  PERFORM 1 FROM public.client_intake WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found' USING ERRCODE='P0002'; END IF;
  IF p_operation = 'start' THEN
    SELECT * INTO c FROM public.discovery_calls WHERE lead_id = p_lead_id AND status = 'draft';
    IF FOUND THEN RETURN to_jsonb(c); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.intake_form_versions v JOIN public.intake_form_templates t ON t.id=v.template_id WHERE v.id=p_version_id AND v.status='published' AND t.purpose='discovery_call' AND t.archived_at IS NULL) THEN RAISE EXCEPTION 'Discovery form unavailable' USING ERRCODE='22023'; END IF;
    INSERT INTO public.discovery_calls(lead_id,form_version_id,answers,created_by,updated_by) VALUES(p_lead_id,p_version_id,p_answers,p_actor_id,p_actor_id) RETURNING * INTO c;
    RETURN to_jsonb(c);
  END IF;
  SELECT * INTO c FROM public.discovery_calls WHERE id=p_call_id AND lead_id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call not found' USING ERRCODE='P0002'; END IF;
  IF p_operation='amend' THEN
    IF c.status <> 'completed' THEN RAISE EXCEPTION 'Complete the call before amending' USING ERRCODE='22023'; END IF;
    INSERT INTO public.discovery_call_amendments(call_id,body,actor_id) VALUES(c.id,p_amendment,p_actor_id) RETURNING id INTO a;
    RETURN jsonb_build_object('amendmentId',a);
  END IF;
  IF p_operation='complete' AND c.status='completed' THEN RETURN to_jsonb(c); END IF;
  IF c.status <> 'draft' OR c.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Call changed; reload before saving' USING ERRCODE='40001'; END IF;
  IF p_operation NOT IN ('save','complete') THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  IF p_operation='complete' THEN
    IF nullif(p_answers->>'discovery_call_at','') IS NULL OR coalesce(p_answers->>'discovery_outcome','') NOT IN ('proceed','needs_review','not_a_fit') OR coalesce(p_answers->>'discovery_next_action','') NOT IN ('send_organizer','schedule_meeting','request_information','attorney_review','other_follow_up','no_further_action') OR (p_answers->>'discovery_next_action'='no_further_action' AND nullif(btrim(p_answers->>'discovery_action_reason'),'') IS NULL) THEN RAISE EXCEPTION 'Complete required answers' USING ERRCODE='22023'; END IF;
    INSERT INTO public.lead_activity(lead_id,event_type,title,detail,actor_id)
    VALUES(p_lead_id,'discovery_call_completed','Discovery call completed',c.id::text,p_actor_id) RETURNING id INTO a;
  END IF;
  UPDATE public.discovery_calls SET answers=p_answers, revision=revision+1, updated_by=p_actor_id, updated_at=now(),
    status=CASE WHEN p_operation='complete' THEN 'completed' ELSE 'draft' END,
    completed_at=CASE WHEN p_operation='complete' THEN now() ELSE NULL END,
    summary=CASE WHEN p_operation='complete' THEN p_summary ELSE NULL END, activity_id=a
    WHERE id=c.id RETURNING * INTO c;
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.discovery_call_write(uuid,uuid,text,uuid,integer,jsonb,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discovery_call_write(uuid,uuid,text,uuid,integer,jsonb,text,uuid,text) TO service_role;

CREATE FUNCTION public.guard_completed_discovery() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status='completed' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed calls are immutable; append an amendment'; END IF;
  IF NEW.lead_id <> OLD.lead_id OR NEW.form_version_id <> OLD.form_version_id THEN RAISE EXCEPTION 'Call identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER discovery_completed_guard BEFORE UPDATE ON public.discovery_calls FOR EACH ROW EXECUTE FUNCTION public.guard_completed_discovery();
NOTIFY pgrst, 'reload schema';

CREATE FUNCTION public.discovery_fact_snapshot(p_lead_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT jsonb_build_object('firstName',l.first_name,'lastName',l.last_name,'email',l.email,'phone',l.phone,'maritalStatus',l.marital_status,'hasMinorChildren',l.has_minor_children,
 'address',jsonb_build_object('addressLine1',l.address_line1,'addressLine2',l.address_line2,'city',l.city,'state',l.state,'zip',l.zip,'county',l.county),
 'spouse',(SELECT jsonb_build_object('firstName',c.first_name,'lastName',c.last_name,'middleName',c.middle_name,'preferredName',c.preferred_name,'email',c.email,'phone',c.phone,'dateOfBirth',c.date_of_birth)
 FROM public.matter_contacts mc JOIN public.contacts c ON c.id=mc.contact_id WHERE mc.matter_id=l.matter_id AND mc.relationship_type='spouse' LIMIT 1))
 FROM public.client_intake l WHERE l.id=p_lead_id;
$$;
REVOKE ALL ON FUNCTION public.discovery_fact_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discovery_fact_snapshot(uuid) TO service_role;
CREATE FUNCTION public.apply_discovery_facts(p_lead_id uuid,p_call_id uuid,p_actor_id uuid,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE change jsonb; snapshot jsonb; m uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=p_actor_id AND role IN ('admin','attorney')) THEN RAISE EXCEPTION 'Staff required' USING ERRCODE='42501'; END IF;
 SELECT matter_id INTO m FROM public.client_intake WHERE id=p_lead_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.discovery_calls WHERE id=p_call_id AND lead_id=p_lead_id AND status='completed') THEN RAISE EXCEPTION 'Completed call not found' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.matters WHERE id=m FOR UPDATE;
 PERFORM 1 FROM public.matter_contacts WHERE matter_id=m AND relationship_type='spouse' FOR UPDATE;
 PERFORM 1 FROM public.contacts WHERE id IN (SELECT contact_id FROM public.matter_contacts WHERE matter_id=m AND relationship_type='spouse') FOR UPDATE;
 snapshot := public.discovery_fact_snapshot(p_lead_id);
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
   IF change->>'field' NOT IN ('firstName','lastName','email','phone','address','spouse','maritalStatus','hasMinorChildren') THEN RAISE EXCEPTION 'Field cannot be applied' USING ERRCODE='22023'; END IF;
   IF snapshot->(change->>'field') IS DISTINCT FROM change->'expected' THEN RAISE EXCEPTION 'Facts changed; review current values again' USING ERRCODE='40001'; END IF;
 END LOOP;
 FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
   PERFORM public.update_lead_opportunity_field(p_lead_id,change->>'field',change->'value',p_actor_id);
 END LOOP;
 RETURN public.discovery_fact_snapshot(p_lead_id);
END $$;
REVOKE ALL ON FUNCTION public.apply_discovery_facts(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_discovery_facts(uuid,uuid,uuid,jsonb) TO service_role;
-- Amendments are append-only even for the server role. Parent deletion still cascades.
REVOKE UPDATE, DELETE ON public.discovery_call_amendments FROM service_role;
