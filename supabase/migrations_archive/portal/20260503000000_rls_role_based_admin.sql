-- Migrate all admin RLS policies from hardcoded email checks to role-based checks.
-- Old pattern: (auth.jwt() ->> 'email') = 'scott@aubreylegal.com'
--              (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
-- New pattern: EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin'))

-- ── va_tasks ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_all_tasks" ON va_tasks;
CREATE POLICY "admin_all_tasks" ON va_tasks
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── va_task_comments ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_all_comments" ON va_task_comments;
CREATE POLICY "admin_all_comments" ON va_task_comments
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── va_task_documents ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_all_documents" ON va_task_documents;
CREATE POLICY "admin_all_documents" ON va_task_documents
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── va_audit_log ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_all_audit" ON va_audit_log;
CREATE POLICY "admin_all_audit" ON va_audit_log
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── matter_documents ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admin_all" ON matter_documents;
CREATE POLICY "admin_all" ON matter_documents
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── matter_alerts ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_full_access_alerts" ON matter_alerts;
CREATE POLICY "attorneys_full_access_alerts" ON matter_alerts
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── matter_flags ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_full_access_flags" ON matter_flags;
CREATE POLICY "attorneys_full_access_flags" ON matter_flags
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── matter_stage_rules ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_read_stage_rules" ON matter_stage_rules;
CREATE POLICY "attorneys_read_stage_rules" ON matter_stage_rules
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── intake_required_fields ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_full_access_required_fields" ON intake_required_fields;
CREATE POLICY "attorneys_full_access_required_fields" ON intake_required_fields
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── folders ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorney_select_all_folders" ON folders;
CREATE POLICY "attorney_select_all_folders" ON folders
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "attorney_all_folders" ON folders;
CREATE POLICY "attorney_all_folders" ON folders
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── document_access_audit ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorney_select_document_access_audit" ON document_access_audit;
CREATE POLICY "attorney_select_document_access_audit" ON document_access_audit
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── matter_details ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_full_access_matter_details" ON matter_details;
CREATE POLICY "attorneys_full_access_matter_details" ON matter_details
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── stage_task_templates ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_manage_stage_task_templates" ON stage_task_templates;
CREATE POLICY "attorneys_manage_stage_task_templates" ON stage_task_templates
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── stage_task_template_subtasks ───────────────────────────────────────────────

DROP POLICY IF EXISTS "attorneys_manage_stage_task_template_subtasks" ON stage_task_template_subtasks;
CREATE POLICY "attorneys_manage_stage_task_template_subtasks" ON stage_task_template_subtasks
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── referral_sources ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can view referral sources" ON public.referral_sources;
CREATE POLICY "Admins can view referral sources" ON public.referral_sources
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can insert referral sources" ON public.referral_sources;
CREATE POLICY "Admins can insert referral sources" ON public.referral_sources
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can update referral sources" ON public.referral_sources;
CREATE POLICY "Admins can update referral sources" ON public.referral_sources
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can delete referral sources" ON public.referral_sources;
CREATE POLICY "Admins can delete referral sources" ON public.referral_sources
  FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── engagement_agreements ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can view engagement agreements" ON public.engagement_agreements;
CREATE POLICY "Admins can view engagement agreements" ON public.engagement_agreements
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can insert engagement agreements" ON public.engagement_agreements;
CREATE POLICY "Admins can insert engagement agreements" ON public.engagement_agreements
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can update engagement agreements" ON public.engagement_agreements;
CREATE POLICY "Admins can update engagement agreements" ON public.engagement_agreements
  FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can delete engagement agreements" ON public.engagement_agreements;
CREATE POLICY "Admins can delete engagement agreements" ON public.engagement_agreements
  FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

-- ── lead_activity ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can view lead activity" ON public.lead_activity;
CREATE POLICY "Admins can view lead activity" ON public.lead_activity
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));

DROP POLICY IF EXISTS "Admins can insert lead activity" ON public.lead_activity;
CREATE POLICY "Admins can insert lead activity" ON public.lead_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('attorney', 'admin')));
