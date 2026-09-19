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

  // AI drafting fallback
  'ANTHROPIC_API_KEY',

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

// Optional features: absent is fine, half-configured is a deployment mistake
// that would otherwise only surface as a silently disabled feature.
const PARTIAL_FEATURES = [
  {
    name: 'Online invoice payment',
    trigger: 'PAYMENTS_PROVIDER',
    // Only Stripe needs keys today; LawPay is a stub with nothing to configure.
    requires: (value) => (value === 'stripe' ? ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] : []),
  },
  {
    name: 'Resend delivery tracking (bounces and complaints)',
    trigger: 'RESEND_API_KEY',
    // Without the signing secret /api/webhooks/resend 503s every delivery, so
    // no bounce or spam complaint is ever recorded against the send. That is
    // the quiet way a sending domain's reputation decays — and this domain
    // carries engagement-agreement signing links.
    requires: () => ['RESEND_WEBHOOK_SIGNING_SECRET'],
    // The trigger is a credential, so its value must never reach the output.
    secret: true,
  },
  {
    name: 'Mercury bank reconciliation',
    trigger: 'MERCURY_API_TOKEN',
    // Without the account allowlist every deposit reads as "wrong account",
    // which looks like an empty feature rather than a missing setting.
    requires: () => ['MERCURY_INCOME_ACCOUNT_IDS'],
    // The trigger is a credential, so its value must never reach the output.
    secret: true,
  },
]

for (const feature of PARTIAL_FEATURES) {
  const value = process.env[feature.trigger]?.trim()
  if (!value) continue
  const absent = feature.requires(value).filter((name) => !process.env[name])
  if (absent.length > 0) {
    console.warn(
      `\n⚠ ${feature.name} is switched on via ${feature.trigger}` +
        `${feature.secret ? '' : `=${value}`} but ` +
        `${absent.join(', ')} ${absent.length === 1 ? 'is' : 'are'} unset — the feature will stay disabled.\n`,
    )
  }
}

console.log('✓ All required environment variables are set')
