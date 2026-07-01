-- Link auth users to client_intake records
ALTER TABLE client_intake
  ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS account_created_at TIMESTAMPTZ;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS client_intake_client_user_id_idx
ON client_intake (client_user_id);

-- RLS: allow authenticated clients to read/write their own intake row
ALTER TABLE client_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Client can read own intake" ON client_intake
  FOR SELECT USING (auth.uid() = client_user_id);

CREATE POLICY "Client can update own intake" ON client_intake
  FOR UPDATE USING (auth.uid() = client_user_id);

-- Admin service role bypasses RLS (already the case with service role key)
