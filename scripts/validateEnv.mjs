// Startup environment variable check.
// Run via `node scripts/validateEnv.mjs` before starting the server.
// Exits 1 with a clear listing of every missing variable so the operator
// can fix them in Vercel before the app serves any traffic.

const REQUIRED_AT_RUNTIME = [
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
