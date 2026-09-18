import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The intake lock, as the database enforces it.
 *
 * `client_intake_update_own` granted a signed-in client unrestricted UPDATE on
 * their own row — no column restriction. Both halves of a PostgREST request
 * were already in their hands: the anon key ships in the browser bundle and the
 * portal JWT is their own session. So the "Intake is locked. Contact your
 * attorney to make changes." gate in app/api/intake/route.ts was advisory. A
 * client could set `status` back to 'draft' on a questionnaire the attorney had
 * already received, rewrite the answers under it, and clear the readiness flags,
 * leaving nothing behind to say it happened.
 *
 * This runs the real credentials against the real migrated schema, because the
 * claim is about what the database permits and nothing mocked can answer that.
 * The failure mode is quiet by design: with no UPDATE policy, PostgREST matches
 * no rows and returns success with an empty set rather than an error — so every
 * assertion here reads the row back through the service role instead of
 * trusting the client's response.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

const password = `pw-${randomUUID()}`
const email = `intake-rls-${randomUUID()}@example.invalid`
const otherEmail = `intake-rls-other-${randomUUID()}@example.invalid`

let userId: string
let otherUserId: string
let intakeId: string
let otherIntakeId: string
/** The anon key plus this client's own session — what their browser holds. */
let asClient: SupabaseClient

async function createPortalUser(address: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: address,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  const { error: profileError } = await admin
    .from('users')
    .upsert({ id: data.user.id, email: address, role: 'client' }, { onConflict: 'id' })
  if (profileError) throw new Error(`profile upsert failed: ${profileError.message}`)
  return data.user.id
}

async function createSubmittedIntake(owner: string, address: string): Promise<string> {
  const { data, error } = await admin
    .from('client_intake')
    .insert({
      user_id: owner,
      email: address,
      status: 'submitted',
      first_name: 'Reviewed',
      attorney_review_flags: ['needs_review'],
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`intake insert failed: ${error?.message}`)
  return data.id as string
}

/** The row as the firm sees it, bypassing RLS. */
async function readBack(id: string) {
  const { data, error } = await admin
    .from('client_intake')
    .select('status, first_name, attorney_review_flags')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`read back failed: ${error?.message}`)
  return data
}

beforeAll(async () => {
  userId = await createPortalUser(email)
  otherUserId = await createPortalUser(otherEmail)
  intakeId = await createSubmittedIntake(userId, email)
  otherIntakeId = await createSubmittedIntake(otherUserId, otherEmail)

  asClient = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error } = await asClient.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`client sign-in failed: ${error.message}`)
}, 30_000)

afterAll(async () => {
  await admin.from('client_intake').delete().in('id', [intakeId, otherIntakeId].filter(Boolean))
  for (const id of [userId, otherUserId].filter(Boolean)) {
    await admin.from('users').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id).catch(() => undefined)
  }
})

describe('client_intake under a portal client’s own credentials', () => {
  it('lets them read their own questionnaire', async () => {
    // Load-bearing, not a courtesy: lib/portal/getMatterForUser.ts proves
    // ownership with exactly this read before it touches anything else.
    const { data, error } = await asClient
      .from('client_intake')
      .select('id, status')
      .eq('id', intakeId)

    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data?.[0]?.status).toBe('submitted')
  })

  it('shows them nothing of anyone else’s', async () => {
    const { data, error } = await asClient
      .from('client_intake')
      .select('id')
      .eq('id', otherIntakeId)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('does not let them reopen a submitted questionnaire', async () => {
    await asClient
      .from('client_intake')
      .update({ status: 'draft' })
      .eq('id', intakeId)

    expect((await readBack(intakeId)).status).toBe('submitted')
  })

  it('does not let them rewrite answers the attorney has already read', async () => {
    await asClient
      .from('client_intake')
      .update({ first_name: 'Rewritten', attorney_review_flags: [] })
      .eq('id', intakeId)

    const row = await readBack(intakeId)
    expect(row.first_name).toBe('Reviewed')
    expect(row.attorney_review_flags).toEqual(['needs_review'])
  })

  it('does not let them add rows to the firm’s lead table', async () => {
    // client_intake is where lib/leads/createLead.ts puts new leads, so an
    // INSERT policy here is a way into the CRM, not just into one's own record.
    const before = await admin
      .from('client_intake')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    const { error } = await asClient
      .from('client_intake')
      .insert({ user_id: userId, email, status: 'draft' })

    expect(error).not.toBeNull()

    const after = await admin
      .from('client_intake')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    expect(after.count).toBe(before.count)
  })

  it('still lets the firm write, which is how the questionnaire saves', async () => {
    // /api/intake now writes through the service role after checking ownership
    // itself. If that were blocked too, the client could not save at all.
    const { error } = await admin
      .from('client_intake')
      .update({ first_name: 'Reviewed' })
      .eq('id', intakeId)

    expect(error).toBeNull()
  })
})
