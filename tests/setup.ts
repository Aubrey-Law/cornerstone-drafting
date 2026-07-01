import { config } from 'dotenv'

// Tests load `.env.test` if present; fall back to `.env.local`.
config({ path: '.env.test', override: false })
config({ path: '.env.local', override: false })

// Static analysis tests do not need a live Supabase project. Integration tests
// that require real credentials should skip when env is missing.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co'
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service-role-key'
}
