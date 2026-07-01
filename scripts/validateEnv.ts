/**
 * Startup environment variable check.
 * Run via `npm run validate-env` before starting the server.
 * Exits 1 with a clear listing of every missing variable so the operator
 * can fix them in Vercel before the app serves any traffic.
 */

// Variables whose absence causes a silent feature failure or hard crash at runtime.
// NEXT_PUBLIC_* vars are listed here because the server SDK reads them too
// (Supabase SSR client, health check, etc.).
const REQUIRED_AT_RUNTIME: string[] = [
  // Supabase
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',

  // Document storage (Cloudflare R2)
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',

  // AI drafting
  'ANTHROPIC_API_KEY',

  // Transactional email
  'RESEND_API_KEY',

  // Admin auth guard — used in multiple API routes to identify the attorney
  'ADMIN_EMAIL',
]

const missing = REQUIRED_AT_RUNTIME.filter((name) => !process.env[name])

if (missing.length > 0) {
  console.error('\n❌ Missing required environment variables:\n')
  for (const name of missing) {
    console.error(`   • ${name}`)
  }
  console.error(
    '\nSet these in Vercel Project Settings > Environment Variables and redeploy.\n',
  )
  process.exit(1)
}

console.log('✓ All required environment variables are set')
