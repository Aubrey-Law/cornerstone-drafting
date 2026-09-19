import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Taking a signature request back, and chasing one that is still out.
 *
 * Both are small functions whose value is entirely in their refusals and their
 * ordering. The one that matters most is invisible from the outside: a cancel
 * that flips the parent row before closing the sessions looks cancelled in the
 * admin UI while every link already in a client's inbox still signs.
 */

const state = vi.hoisted(() => ({
  /** Every write, in the order it was issued. */
  log: [] as Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }>,
  rows: {} as Record<string, Record<string, unknown> | null>,
  emails: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let entry: { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> } | null = null
      const chain: Record<string, unknown> = {}
      const record = (op: string, payload?: unknown) => {
        entry = { table, op, payload, filters }
        state.log.push(entry)
        return chain
      }
      chain.select = () => chain
      chain.insert = (payload: unknown) => record('insert', payload)
      chain.update = (payload: unknown) => record('update', payload)
      for (const method of ['eq', 'neq', 'in', 'is']) {
        chain[method] = (column: string, value: unknown) => {
          filters.push([`${method}:${column}`, value])
          return chain
        }
      }
      chain.maybeSingle = async () => ({ data: state.rows[table] ?? null, error: null })
      chain.single = async () => ({ data: state.rows[table] ?? null, error: null })
      chain.then = (resolve: (value: { data: unknown; error: null }) => void) => {
        resolve({ data: state.rows[table] ?? null, error: null })
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (message: Record<string, unknown>) => {
    state.emails.push(message)
    return { ok: true }
  }),
}))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => {}) }))

import { completeDocumentSignature } from '@/lib/esign/documentSignature'
import {
  cancelDocumentSignatureRequest,
  resendDocumentSignatureLink,
} from '@/lib/esign/documentLifecycle'

const REQUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** Writes against one table, in order. */
const writes = (table: string) => state.log.filter(row => row.table === table)
const index = (table: string, op: string) =>
  state.log.findIndex(row => row.table === table && row.op === op)

beforeEach(() => {
  state.log = []
  state.emails = []
  state.rows = {
    signature_requests: { id: REQUEST, matter_id: 'matter-1', name: 'HIPAA Authorization', status: 'sent' },
    signature_request_recipients: { request_id: REQUEST, recipient_key: 'signer_1', name: 'Walter White', email: 'walter@example.com' },
    esign_signing_sessions: { signature_request_id: REQUEST, recipient_key: 'signer_1', status: 'sent', expires_at: '2026-10-01T00:00:00Z', viewed_at: null },
  }
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('cancelling a request', () => {
  it('closes the signing sessions before it marks the request cancelled', async () => {
    // The whole point. The signing route finds a session by token hash and
    // never reads the parent, so until the sessions are closed every link that
    // has been emailed still signs. Flipping the parent first leaves a window
    // where the firm believes it is withdrawn and the client can still sign.
    await cancelDocumentSignatureRequest({ requestId: REQUEST, reason: 'Wrong version sent', cancelledBy: 'user-1' })

    const sessions = index('esign_signing_sessions', 'update')
    const parent = index('signature_requests', 'update')
    expect(sessions).toBeGreaterThan(-1)
    expect(parent).toBeGreaterThan(-1)
    expect(sessions).toBeLessThan(parent)
  })

  it('leaves a signature or a decline alone', async () => {
    // Someone who already signed did sign. Cancelling the request does not
    // unmake that, and the certificate has to keep saying so.
    await cancelDocumentSignatureRequest({ requestId: REQUEST, reason: 'Wrong version sent', cancelledBy: 'user-1' })

    const update = writes('esign_signing_sessions').find(row => row.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'cancelled' })
    expect(update?.filters).toContainEqual(['in:status', ['sent', 'viewed']])
  })

  it('cannot clobber a request that completed underneath it', async () => {
    await cancelDocumentSignatureRequest({ requestId: REQUEST, reason: 'Wrong version sent', cancelledBy: 'user-1' })

    const update = writes('signature_requests').find(row => row.op === 'update')
    expect(update?.payload).toMatchObject({ status: 'cancelled' })
    expect(update?.filters).toContainEqual(['neq:status', 'completed'])
  })

  it('records who withdrew it and why, against the request rather than a signer', async () => {
    await cancelDocumentSignatureRequest({ requestId: REQUEST, reason: 'Client asked us to hold', cancelledBy: 'user-1' })

    const audit = writes('esign_audit_events').find(row => row.op === 'insert')
    expect(audit?.payload).toMatchObject({
      signature_request_id: REQUEST,
      event_type: 'cancelled',
      detail: { reason: 'Client asked us to hold', cancelled_by: 'user-1' },
    })
    // No session_id: the firm did this, not a signer, and the certificate
    // should not attribute it to one.
    expect((audit?.payload as Record<string, unknown>).session_id).toBeUndefined()
  })

  it('refuses a request that is already finished', async () => {
    state.rows.signature_requests = { id: REQUEST, status: 'completed', name: 'HIPAA Authorization' }
    await expect(cancelDocumentSignatureRequest({ requestId: REQUEST, reason: 'too late', cancelledBy: 'user-1' }))
      .rejects.toThrow(/completed/i)
    expect(state.log).toHaveLength(0)
  })

  it('refuses a request that was never sent', async () => {
    state.rows.signature_requests = { id: REQUEST, status: 'draft', name: 'HIPAA Authorization' }
    await expect(cancelDocumentSignatureRequest({ requestId: REQUEST, reason: 'never mind', cancelledBy: 'user-1' }))
      .rejects.toThrow(/not out for signature/i)
  })

  it('refuses without a reason, because the reason is what gets recorded', async () => {
    await expect(cancelDocumentSignatureRequest({ requestId: REQUEST, reason: '   ', cancelledBy: 'user-1' }))
      .rejects.toThrow(/say why/i)
    expect(state.log).toHaveLength(0)
  })
})

describe('resending a link', () => {
  it('updates the existing session rather than inserting a second one', async () => {
    // esign_signing_sessions_request_recipient_key is a partial unique index on
    // (signature_request_id, recipient_key). An insert here is a constraint
    // violation, and reusing the send path's code is how you would write one.
    await resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' })

    expect(writes('esign_signing_sessions').map(row => row.op)).toEqual(['update'])
  })

  it('mints a fresh link and never writes the raw token anywhere', async () => {
    await resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' })

    const update = writes('esign_signing_sessions')[0].payload as Record<string, string>
    expect(update.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(update.expires_at).toEqual(expect.any(String))

    const link = String(state.emails[0].text).split('/sign/')[1].trim()
    expect(link).not.toBe('')
    expect(JSON.stringify(state.log)).not.toContain(link)
  })

  it('reopens a link that had lapsed', async () => {
    // Rotating the token without resetting the status is the engagement path's
    // bug: expires_at moves into the future, the gate still reads the status
    // and refuses, and the client gets a fresh link that does not work.
    state.rows.esign_signing_sessions = {
      signature_request_id: REQUEST, recipient_key: 'signer_1', status: 'expired',
      expires_at: '2026-01-01T00:00:00Z', viewed_at: null,
    }
    await resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' })

    expect(writes('esign_signing_sessions')[0].payload).toMatchObject({ status: 'sent' })
  })

  it('does not erase the fact that a signer already opened it', async () => {
    // They did open it. Resetting a viewed session to `sent` would quietly
    // withdraw that from the record to make the resend look tidier.
    state.rows.esign_signing_sessions = {
      signature_request_id: REQUEST, recipient_key: 'signer_1', status: 'viewed',
      expires_at: '2026-10-01T00:00:00Z', viewed_at: '2026-09-18T10:00:00Z',
    }
    await resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' })

    const payload = writes('esign_signing_sessions')[0].payload as Record<string, unknown>
    expect(payload.status).toBeUndefined()
    expect(payload.viewed_at).toBeUndefined()
  })

  it('honours the expiry it was given instead of silently resetting it', async () => {
    // native.ts calls createSigningToken() with no arguments on every resend,
    // so a re-sent engagement link quietly gets the 30-day default however
    // short the original was.
    const now = Date.now()
    await resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1', expirationHours: 24 })

    const { expires_at: expiresAt } = writes('esign_signing_sessions')[0].payload as Record<string, string>
    const days = (Date.parse(expiresAt) - now) / 86_400_000
    expect(days).toBeGreaterThan(0.5)
    expect(days).toBeLessThan(2)
  })

  it('records the reminder against the recipient', async () => {
    await resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' })

    const update = writes('signature_request_recipients').find(row => row.op === 'update')
    expect(update?.payload).toMatchObject({ last_reminded_at: expect.any(String) })
    const audit = writes('esign_audit_events').find(row => row.op === 'insert')
    expect(audit?.payload).toMatchObject({
      event_type: 'emailed',
      detail: { category: 'esign_signature_reminder', recipient_key: 'signer_1' },
    })
  })

  it('refuses a signer who is already done', async () => {
    state.rows.esign_signing_sessions = {
      signature_request_id: REQUEST, recipient_key: 'signer_1', status: 'signed',
      expires_at: '2026-10-01T00:00:00Z', viewed_at: null,
    }
    await expect(resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' }))
      .rejects.toThrow(/already signed/i)
    expect(state.emails).toHaveLength(0)
  })

  it('refuses once the request itself is withdrawn', async () => {
    state.rows.signature_requests = { id: REQUEST, status: 'cancelled', name: 'HIPAA Authorization' }
    await expect(resendDocumentSignatureLink({ requestId: REQUEST, recipientKey: 'signer_1' }))
      .rejects.toThrow(/not out for signature/i)
  })
})

describe('completing a withdrawn request', () => {
  it('refuses to file an executed copy of a document the firm took back', async () => {
    // Cancelling closes the sessions, so this should be unreachable. It is here
    // because "should be unreachable" is how the last four defects on this path
    // were described.
    state.rows.signature_requests = { id: REQUEST, matter_id: 'matter-1', name: 'HIPAA Authorization', status: 'cancelled' }

    const result = await completeDocumentSignature({
      requestId: REQUEST,
      sealedPdf: Buffer.from('%PDF-1.7'),
      sha256: 'a'.repeat(64),
    })

    expect(result).toEqual({ ok: false, error: 'This signature request was withdrawn' })
    expect(writes('matter_documents')).toHaveLength(0)
  })
})
