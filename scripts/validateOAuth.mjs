// Smoke-test Supabase OAuth provider wiring for Google.
// Run: node scripts/validateOAuth.mjs [callback-origin]
//
// Example:
//   node scripts/validateOAuth.mjs https://cornerstone.aubreylegal.com

import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.join(process.cwd(), envFile)
  if (fs.existsSync(envPath)) {
    config({ path: envPath })
    break
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const callbackOrigin =
  process.argv[2] ??
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_SITE_URL ??
  'https://cornerstone.aubreylegal.com'

if (!supabaseUrl || !anonKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const redirectTo = `${callbackOrigin.replace(/\/$/, '')}/auth/callback`
const headers = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
}

async function checkProvider(provider) {
  const url = new URL(`${supabaseUrl}/auth/v1/authorize`)
  url.searchParams.set('provider', provider)
  url.searchParams.set('redirect_to', redirectTo)

  const res = await fetch(url, { headers, redirect: 'manual' })
  const location = res.headers.get('location') ?? ''

  return { provider, status: res.status, location }
}

function diagnose(provider, location) {
  if (!location) return 'No redirect location returned'

  if (provider === 'google') {
    if (location.includes('accounts.google.com')) return null
    return `Expected accounts.google.com redirect, got: ${location}`
  }

  return null
}

console.log(`Checking OAuth for callback: ${redirectTo}\n`)

let failed = false
for (const provider of ['google']) {
  const { status, location } = await checkProvider(provider)
  const problem = diagnose(provider, location)

  if (status !== 302 || problem) {
    failed = true
    console.error(`✗ ${provider}: HTTP ${status}`)
    if (location) console.error(`  location: ${location}`)
    if (problem) console.error(`  ${problem}`)
  } else {
    console.log(`✓ ${provider}: redirects to provider login`)
  }
}

if (failed) {
  console.error('\nOAuth providers need attention before social login will work.')
  process.exit(1)
}

console.log('\nOAuth provider redirects look healthy.')
