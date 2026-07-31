/**
 * Seed a deterministic, idempotent fixture for real-browser testing against
 * the LOCAL Supabase stack (see AGENTS.md for bringing that up):
 *
 *   - Staff login    attorney@example.com / Password123!  → /admin/*
 *   - Client login   client@example.com  / Password123!   → portal /dashboard
 *   - A lead         (client_intake + linked opportunity matter)
 *   - A hired matter (via the same convert_lead_to_matter RPC the app uses)
 *
 * Usage:
 *   npm run seed:browser-fixture
 *
 * Reads `.env.test` then `.env.local` (same order as the vitest harness).
 * Refuses to run against a non-local Supabase URL unless --allow-remote is
 * passed, so it cannot accidentally write fixture rows into a hosted project.
 * Safe to re-run: users, intakes, and matters are matched by fixed emails.
 */
import { config } from 'dotenv'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

config({ path: '.env.test', override: false })
config({ path: '.env.local', override: false })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.SUPABASE_AUTH_SITE_URL ?? 'http://localhost:3002'

const STAFF = { email: 'attorney@example.com', password: 'Password123!', name: 'Test Attorney' }
const CLIENT = { email: 'client@example.com', password: 'Password123!', name: 'Jordan Client' }
const LEAD_EMAIL = 'lead@example.com'

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (via .env.test or .env.local).')
}

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|host\.docker\.internal)(:\d+)?\/?$/.test(SUPABASE_URL)
if (!isLocal && !process.argv.includes('--allow-remote')) {
  fail(`${SUPABASE_URL} is not a local Supabase URL. Pass --allow-remote only for a disposable branch DB — never production.`)
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function ensureAuthUser(email: string, password: string): Promise<User> {
  // Local stacks hold a handful of users; one page is plenty.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 })
  if (error) fail(`Could not list auth users: ${error.message}`)
  const existing = data.users.find(u => u.email?.toLowerCase() === email)
  if (existing) return existing

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created.user) fail(`Could not create auth user ${email}: ${createError?.message}`)
  return created.user
}

async function ensureProfile(user: User, role: 'attorney' | 'client', displayName: string) {
  const { error } = await admin
    .from('users')
    .upsert({ id: user.id, email: user.email, display_name: displayName, role }, { onConflict: 'id' })
  if (error) fail(`Could not upsert public.users row for ${user.email}: ${error.message}`)
}

interface IntakeSeed {
  email: string
  first_name: string
  last_name: string
  phone: string
  city: string
  state: string
  lead_source: string
  practice_area: string
  marital_status: string
  user_id?: string
  client_user_id?: string
}

/** Insert-or-update a client_intake by email. The ensure_lead_matter trigger
 *  creates/syncs the linked opportunity matter whenever lead_status is set. */
async function ensureLeadIntake(seed: IntakeSeed): Promise<{ id: string; matter_id: string | null }> {
  const { data: rows, error: findError } = await admin
    .from('client_intake')
    .select('id, matter_id, lead_status')
    .ilike('email', seed.email)
    .order('created_at', { ascending: true })
    .limit(1)
  if (findError) fail(`Could not query client_intake: ${findError.message}`)

  const payload = {
    ...seed,
    full_name: `${seed.first_name} ${seed.last_name}`,
    lead_status: 'lead',
    status: 'draft',
  }

  if (rows?.length) {
    // Keep re-runs non-destructive: if in-browser testing already advanced
    // this row's lifecycle (e.g. hired the lead), leave lead_status alone.
    const update: Record<string, unknown> = { ...payload, updated_at: new Date().toISOString() }
    if (rows[0].lead_status) delete update.lead_status
    const { data, error } = await admin
      .from('client_intake')
      .update(update)
      .eq('id', rows[0].id)
      .select('id, matter_id')
      .single()
    if (error || !data) fail(`Could not update intake for ${seed.email}: ${error?.message}`)
    return data
  }

  const { data, error } = await admin
    .from('client_intake')
    .insert(payload)
    .select('id, matter_id')
    .single()
  if (error || !data) fail(`Could not insert intake for ${seed.email}: ${error?.message}`)
  return data
}

async function hireMatter(intakeId: string, clientUserId: string, matterName: string) {
  // Same RPC the e-sign webhook and the Leads page hire action call; it is
  // idempotent and returns the existing matter when already hired.
  const { data, error } = await admin.rpc('convert_lead_to_matter', {
    p_lead_id: intakeId,
    p_matter_number: '2026-EP-FIXTURE-1',
    p_matter_name: matterName,
    p_practice_area: 'EP',
    p_client_id: clientUserId,
    p_fee: 4500,
    p_engagement_provider: null,
    p_engagement_envelope_id: null,
    p_engagement_status: 'signed',
    p_engagement_sent_at: new Date().toISOString(),
    p_engagement_signed_at: new Date().toISOString(),
    p_engagement_signed: true,
    p_actor_id: null,
  })
  if (error) fail(`convert_lead_to_matter failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.matter_id) fail('convert_lead_to_matter returned no matter id.')
  return row as { matter_id: string; matter_number: string; created: boolean }
}

async function main() {
  console.log(`Seeding browser fixture into ${SUPABASE_URL}`)

  const staffUser = await ensureAuthUser(STAFF.email, STAFF.password)
  await ensureProfile(staffUser, 'attorney', STAFF.name)
  console.log(`✓ staff user       ${STAFF.email}`)

  const clientUser = await ensureAuthUser(CLIENT.email, CLIENT.password)
  await ensureProfile(clientUser, 'client', CLIENT.name)
  console.log(`✓ client user      ${CLIENT.email}`)

  const lead = await ensureLeadIntake({
    email: LEAD_EMAIL,
    first_name: 'Lena',
    last_name: 'Prospect',
    phone: '(617) 555-0142',
    city: 'Boston',
    state: 'MA',
    lead_source: 'Referral',
    practice_area: 'EP',
    marital_status: 'single',
  })
  console.log(`✓ lead intake      ${lead.id} (matter ${lead.matter_id ?? 'created by trigger'})`)

  const clientIntake = await ensureLeadIntake({
    email: CLIENT.email,
    first_name: 'Jordan',
    last_name: 'Client',
    phone: '(617) 555-0177',
    city: 'Cambridge',
    state: 'MA',
    lead_source: 'Website',
    practice_area: 'EP',
    marital_status: 'married',
    user_id: clientUser.id,
    client_user_id: clientUser.id,
  })
  const hired = await hireMatter(clientIntake.id, clientUser.id, 'Jordan Client — Estate Planning')
  console.log(`✓ hired matter     ${hired.matter_id} (${hired.matter_number ?? 'existing number'})`)

  // First run only: move the matter past intake so the drafting workspace and
  // the portal stage tracker show a representative mid-lifecycle state.
  if (hired.created) {
    const { error } = await admin
      .from('matters')
      .update({ stage: 'drafting', stage_entered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', hired.matter_id)
    if (error) console.warn(`⚠ could not advance matter stage: ${error.message}`)
  }

  console.log(`
Browser-testing entry points (app at ${APP_URL}):
  Staff   ${STAFF.email} / ${STAFF.password}
    Leads list      ${APP_URL}/admin/leads
    Lead detail     ${APP_URL}/admin/leads/${lead.id}
    Matter detail   ${APP_URL}/admin/matters/${hired.matter_id}
    Drafting hub    ${APP_URL}/admin/drafting/${hired.matter_id}
  Client  ${CLIENT.email} / ${CLIENT.password}
    Portal home     ${APP_URL}/dashboard
`)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
