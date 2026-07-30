-- Calendar productivity: per-user/day attention dismissals and workload target.

CREATE TABLE IF NOT EXISTS public.calendar_attention_dismissals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  calendar_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id, calendar_date)
);

ALTER TABLE public.calendar_attention_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage own calendar attention dismissals"
  ON public.calendar_attention_dismissals FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')
    )
  );

GRANT SELECT, INSERT, DELETE ON public.calendar_attention_dismissals TO authenticated;

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS calendar_daily_target_minutes integer NOT NULL DEFAULT 360
  CHECK (calendar_daily_target_minutes BETWEEN 60 AND 720);
