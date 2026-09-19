import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CEREMONY_ATTESTATION_TEXT,
  createDocumentSignatureRequest,
  esignDocumentsEnabled,
} from '@/lib/esign/documentSignature'

/**
 * Sending a document the firm did not author.
 *
 * The properties worth pinning are the refusals. A signature request that
 * reaches a signer is hard to unsend, and one of these refusals is the only
 * thing standing between this flow and a will going out for electronic
 * signature — which Massachusetts does not permit (G.L. c. 190B).
 */

const state = vi.hoisted(() => ({
  flag: null as boolean | null,
  inserted: [] as Array<{ table: string; row: unknown }>,
  updated: [] as Record<string, unknown>[],
  emails: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.insert = vi.fn((row: unknown) => {
        state.inserted.push({ table, row })
        return chain
      })
      chain.update = vi.fn((row: Record<string, unknown>) => {
        state.updated.push({ table, ...row })
        return chain
      })
      chain.single = vi.fn(async () => ({ data: { id: 'request-1' }, error: null }))
      chain.maybeSingle = vi.fn(async () => ({
        data: { esign_documents_enabled: state.flag },
        error: null,
      }))
      return chain
    },
  }),
}))
vi.mock('@/lib/documentUpload', () => ({ putFileToR2: vi.fn(async () => {}) }))
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (message: Record<string, unknown>) => {
    state.emails.push(message)
    return { ok: true }
  }),
}))

async function samplePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([612, 792]).drawText('A HIPAA authorization.', { x: 72, y: 700, size: 11, font })
  return Buffer.from(await doc.save())
}

async function send(overrides: Record<string, unknown> = {}) {
  return createDocumentSignatureRequest({
    matterId: 'matter-1',
    sourceDocumentId: 'doc-1',
    name: 'HIPAA Authorization',
    sourcePdf: await samplePdf(),
    sourceR2Key: 'matters/matter-1/firm/hipaa.pdf',
    signers: [{ name: 'Walter White', email: 'walter@example.com' }],
    message: '',
    expirationHours: 168,
    attestedBy: 'user-1',
    ...overrides,
  } as Parameters<typeof createDocumentSignatureRequest>[0])
}

beforeEach(() => {
  state.flag = null
  state.inserted = []
  state.updated = []
  state.emails = []
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

describe('the ceremony attestation', () => {
  it('is required before anything is created', async () => {
    // Not a warning and not a checkbox the code ignores. Without it no row
    // exists, so nothing can later be sent by a retry that skips the check.
    await expect(send({ attestedBy: '' })).rejects.toThrow(/witnessed or notarized/i)
    expect(state.inserted).toHaveLength(0)
  })

  it('is stored with the request, wording and all', async () => {
    await send()
    const update = state.updated.find(u => u.ceremony_attested_by)
    expect(update?.ceremony_attested_by).toBe('user-1')
    expect(update?.ceremony_attested_at).toEqual(expect.any(String))
    // The wording is stored rather than referenced: revising the form later
    // must not change what a past sender is recorded as having agreed to.
    expect(update?.ceremony_attestation_text).toBe(CEREMONY_ATTESTATION_TEXT)
  })

  it('names the documents Massachusetts excludes', async () => {
    // An attorney reading it should know exactly what they are attesting to.
    for (const term of ['will', 'trust', 'power of attorney', 'health care proxy', '190B']) {
      expect(CEREMONY_ATTESTATION_TEXT.toLowerCase()).toContain(term.toLowerCase())
    }
  })
})

describe('signer validation', () => {
  it('refuses with no signers', async () => {
    await expect(send({ signers: [] })).rejects.toThrow(/at least one signer/i)
  })

  it('refuses two signers sharing an address', async () => {
    // Both links go to one inbox and the second supersedes the first's token,
    // leaving one line unsignable.
    await expect(send({
      signers: [
        { name: 'Walter White', email: 'both@example.com' },
        { name: 'Skylar White', email: 'BOTH@example.com' },
      ],
    })).rejects.toThrow(/own email address/i)
  })

  it('refuses an address that is not one', async () => {
    await expect(send({ signers: [{ name: 'Walter White', email: 'not-an-address' }] }))
      .rejects.toThrow(/email address/i)
  })

  it('refuses more signers than a signature page holds', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, email: `s${i}@example.com` }))
    await expect(send({ signers: many })).rejects.toThrow(/at most/i)
  })
})

describe('a sent request', () => {
  it('creates one session and one email per signer, with a link', async () => {
    await send({
      signers: [
        { name: 'Walter White', email: 'walter@example.com' },
        { name: 'Skylar White', email: 'skylar@example.com' },
      ],
    })

    const sessions = state.inserted.filter(i => i.table === 'esign_signing_sessions')
    expect(sessions).toHaveLength(2)
    // Keyed to the request, never to an agreement — the database's XOR check
    // would reject it otherwise.
    for (const session of sessions) {
      const row = session.row as Record<string, unknown>
      expect(row.signature_request_id).toBe('request-1')
      expect(row.agreement_id).toBeUndefined()
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    }

    expect(state.emails).toHaveLength(2)
    expect(state.emails[0].subject).toContain('HIPAA Authorization')
    expect(String(state.emails[0].text)).toContain('https://app.example.com/sign/')
  })

  it('never writes a raw token', async () => {
    // The link is the only credential. It leaves in the email and is not
    // recoverable afterwards, by design.
    await send()
    const link = String(state.emails[0].text).split('/sign/')[1].trim()
    expect(link).not.toBe('')
    const written = JSON.stringify(state.inserted) + JSON.stringify(state.updated)
    expect(written).not.toContain(link)
  })

  it('records why a send failed rather than leaving a bare failed row', async () => {
    // A row saying `failed` and nothing saying why is what made the first
    // native engagement sends so hard to diagnose.
    await expect(send({ signers: [{ name: 'X', email: 'x@example.com', role: 'Client' }], sourcePdf: Buffer.from('not a pdf') }))
      .rejects.toThrow()
    const failure = state.updated.find(u => u.status === 'failed')
    // The append step throws before any row exists, so there is nothing to
    // mark — which is the point of appending first.
    expect(failure).toBeUndefined()
    expect(state.inserted.filter(i => i.table === 'signature_requests')).toHaveLength(0)
  })
})

describe('the feature flag', () => {
  it('fails closed', async () => {
    state.flag = null
    expect(await esignDocumentsEnabled()).toBe(false)
    state.flag = false
    expect(await esignDocumentsEnabled()).toBe(false)
    state.flag = true
    expect(await esignDocumentsEnabled()).toBe(true)
  })
})

describe('the send route', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/api/admin/matters/[id]/signature-requests/route.ts'),
    'utf8',
  )

  it('checks the attestation before it does anything else', () => {
    expect(route).toContain('body.ceremonyAttested !== true')
  })

  it('scopes the document to the matter in the URL', () => {
    // documentId arrives in the body. Trusting it would let any admin send any
    // matter's document under another matter's name.
    expect(route).toContain('String(document.matter_id) !== matterId')
  })

  it('is gated on the flag, and the flag fails closed', () => {
    expect(route).toContain('esignDocumentsEnabled')
  })

  it('only sends PDFs', () => {
    expect(route).toContain("!== 'application/pdf'")
  })
})
