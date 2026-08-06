/**
 * Tests for the authorization helpers in lib/documentSecurity.ts. These are
 * the actual security boundary today — RLS is bypassed by getAdminClient()
 * everywhere in the documents API, so if these helpers are wrong, the wrong
 * client reads the wrong matter.
 *
 * Strategy: stub out a minimal SupabaseClient that records queries and
 * returns canned data. Lets us assert *what* the helpers ask the DB,
 * independent of network state.
 *
 * For real cross-tenant smoke tests against live Supabase, see
 * rls-coverage.test.ts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isAdminUser,
  userCanAccessMatter,
  userCanReadDocument,
} from '@/lib/documentSecurity'

// ─── Stub client builder ────────────────────────────────────────────────────
// Builds a chainable .from(table).select(...).eq(...).maybeSingle() mock
// that resolves to whatever the table-response map provides.

type Response<T> = { data: T | null; error: { message: string } | null }
type TableResponses = Record<string, Response<unknown> | Response<unknown>[]>

function stubAdmin(responses: TableResponses) {
  const calls = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = (table: string): any => {
    const configured = responses[table]
    const call = calls.get(table) ?? 0
    calls.set(table, call + 1)
    const result = (Array.isArray(configured) ? configured[Math.min(call, configured.length - 1)] : configured)
      ?? { data: null, error: null }
    const thenable = Promise.resolve(result)
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      update: () => chain,
      maybeSingle: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then: thenable.then.bind(thenable),
    }
    return chain
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: builder } as any
}

describe('isAdminUser', () => {
  it('returns false for a null user', async () => {
    expect(await isAdminUser(stubAdmin({}), null)).toBe(false)
    expect(await isAdminUser(stubAdmin({}), undefined)).toBe(false)
  })

  it('returns true when users.role is attorney', async () => {
    const sb = stubAdmin({ users: { data: { role: 'attorney' }, error: null } })
    expect(await isAdminUser(sb, { id: 'u1', email: 'a@example.com' })).toBe(true)
  })

  it('returns true when users.role is admin', async () => {
    const sb = stubAdmin({ users: { data: { role: 'admin' }, error: null } })
    expect(await isAdminUser(sb, { id: 'u1', email: 'a@example.com' })).toBe(true)
  })

  it('returns false when users.role is client', async () => {
    const sb = stubAdmin({ users: { data: { role: 'client' }, error: null } })
    expect(await isAdminUser(sb, { id: 'u1', email: 'a@example.com' })).toBe(false)
  })

  it('returns false when users row is missing (no email-match fallback)', async () => {
    // Regression test for the deleted email-match escape hatch. Previously
    // `email === ADMIN_EMAIL` would grant admin on a missing user row.
    const sb = stubAdmin({ users: { data: null, error: null } })
    expect(await isAdminUser(sb, { id: 'u1', email: 'scott@aubreylegal.com' })).toBe(false)
  })
})

describe('userCanAccessMatter', () => {
  const user = {
    id: 'user-1',
    email: 'client@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
  }

  it('grants access when matters.client_id matches', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: { data: { id: 'matter-1' }, error: null },
      client_intake: { data: null, error: null },
      v_matter_pipeline: { data: null, error: null },
    })
    expect(await userCanAccessMatter(sb, user, 'matter-1')).toBe(true)
  })

  it('grants access via client_intake when matters row not linked', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [
        { data: { id: 'matter-1' }, error: null },
        { data: null, error: null },
      ],
      client_intake: { data: { matter_id: 'matter-1' }, error: null },
      v_matter_pipeline: { data: null, error: null },
    })
    expect(await userCanAccessMatter(sb, user, 'matter-1')).toBe(true)
  })

  it('denies access via v_matter_pipeline when email is not confirmed', async () => {
    // Hardening: an unverified email cannot piggyback on a lead-created
    // matter that hasn't yet been linked to an auth user.
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [
        { data: { id: 'matter-1' }, error: null },
        { data: null, error: null },
      ],
      client_intake: { data: null, error: null },
      v_matter_pipeline: { data: { matter_id: 'matter-1', client_email: 'client@example.com' }, error: null },
    })
    const unverified = { ...user, email_confirmed_at: null }
    expect(await userCanAccessMatter(sb, unverified, 'matter-1')).toBe(false)
  })

  it('grants access via v_matter_pipeline when email IS confirmed', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [
        { data: { id: 'matter-1' }, error: null },
        { data: null, error: null },
      ],
      client_intake: { data: null, error: null },
      v_matter_pipeline: { data: { matter_id: 'matter-1', client_email: 'client@example.com' }, error: null },
    })
    expect(await userCanAccessMatter(sb, user, 'matter-1')).toBe(true)
  })

  it('denies access when no path matches', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [
        { data: { id: 'matter-1' }, error: null },
        { data: null, error: null },
      ],
      client_intake: { data: null, error: null },
      v_matter_pipeline: { data: null, error: null },
    })
    expect(await userCanAccessMatter(sb, user, 'matter-1')).toBe(false)
  })

  it('denies every client access path before the opportunity is hired', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: { data: null, error: null },
      client_intake: { data: { matter_id: 'matter-1' }, error: null },
      v_matter_pipeline: { data: { matter_id: 'matter-1', client_email: user.email }, error: null },
    })
    expect(await userCanAccessMatter(sb, user, 'matter-1')).toBe(false)
  })
})

describe('userCanReadDocument', () => {
  const client = { id: 'client-1', email: 'c@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }

  it('allows an admin to read an unshared document', async () => {
    const sb = stubAdmin({ users: { data: { role: 'attorney' }, error: null } })
    const doc = { matter_id: 'm1', shared_at: null, uploaded_by: 'someone-else' }
    expect(await userCanReadDocument(sb, client, doc)).toBe(true)
  })

  it('denies a client an unshared document they did not upload', async () => {
    // The matter itself IS accessible, so the only thing that can deny this
    // read is shared_at being null on a document the client did not upload.
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [{ data: { id: 'm1' }, error: null }, { data: { id: 'm1' }, error: null }],
      client_intake: { data: null, error: null },
    })
    const doc = { matter_id: 'm1', shared_at: null, uploaded_by: 'someone-else' }
    expect(await userCanReadDocument(sb, client, doc)).toBe(false)
  })

  it('allows a client an unshared document they uploaded themselves', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [{ data: { id: 'm1' }, error: null }, { data: { id: 'm1' }, error: null }],
      client_intake: { data: null, error: null },
    })
    const doc = { matter_id: 'm1', shared_at: null, uploaded_by: 'client-1' }
    expect(await userCanReadDocument(sb, client, doc)).toBe(true)
  })

  it('allows a client a shared document on a matter they own', async () => {
    const sb = stubAdmin({
      users: { data: { role: 'client' }, error: null },
      matters: [{ data: { id: 'm1' }, error: null }, { data: { id: 'm1' }, error: null }],
      client_intake: { data: null, error: null },
    })
    const doc = { matter_id: 'm1', shared_at: '2026-08-01T00:00:00Z', uploaded_by: null }
    expect(await userCanReadDocument(sb, client, doc)).toBe(true)
  })
})

describe('document share route', () => {
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), 'app/api/documents/[id]/route.ts'),
    'utf8',
  )

  it('accepts a shared flag and audits share/unshare', () => {
    expect(routeSource).toContain('const isShareToggle = typeof shared === \'boolean\'')
    expect(routeSource).toContain("shared ? 'share' : 'unshare'")
    expect(routeSource).toContain('shared_at: shared ? new Date().toISOString() : null')
  })

  it('has no sharing gates left', () => {
    expect(routeSource).not.toContain('confirmed')
    expect(routeSource).not.toContain('canPromoteDraft')
    expect(routeSource).not.toContain('wordDocShareBlockReason')
    expect(routeSource).not.toContain('pdf_required')
  })

  it('does not audit plain reads or fail closed on audit errors', () => {
    expect(routeSource).not.toContain('audit_failed')
    expect(routeSource).not.toContain('if (!audit.ok)')
  })
})
