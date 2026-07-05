-- Fix client_intake RLS policies to accept both auth strategies:
--   client_user_id  — set by the magic link callback (new token-based flow)
--   user_id         — set by the server-side session path (direct portal access)
--
-- Both columns can identify the owning client; either one matching is sufficient.

-- Drop the narrow policies created in 20260408_client_auth.sql
DROP POLICY IF EXISTS "Client can read own intake"   ON client_intake;
DROP POLICY IF EXISTS "Client can update own intake" ON client_intake;

-- SELECT: match on either FK
CREATE POLICY "Client can read own intake" ON client_intake
  FOR SELECT USING (
    auth.uid() = client_user_id OR
    auth.uid() = user_id
  );

-- UPDATE: match on either FK
CREATE POLICY "Client can update own intake" ON client_intake
  FOR UPDATE USING (
    auth.uid() = client_user_id OR
    auth.uid() = user_id
  );

-- INSERT: new records created via the session path carry user_id
CREATE POLICY "Client can insert own intake" ON client_intake
  FOR INSERT WITH CHECK (auth.uid() = user_id);
