import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Signing from the portal. The emailed token stays one door to the signing
 * flow; a client signed in to the portal gets a second. These pin which
 * sessions that door admits, how they are described, where they surface, and
 * that the two doors run one flow.
 */

import {
  isSignerEmail,
  portalSigningHref,
  signatureNoun,
  signatureStatusLine,
  signatureTitle,
  summarisePendingSignatures,
  type PortalSignature,
} from '@/lib/portal/signatures'

function signature(overrides: Partial<PortalSignature> = {}): PortalSignature {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    kind: 'engagement',
    label: 'engagement agreement',
    status: 'sent',
    recipientName: 'Pat Smith',
    recipientEmail: 'pat@example.com',
    mine: true,
    sentAt: '2026-10-03T14:00:00Z',
    expiresAt: '2026-10-20T14:00:00Z',
    ...overrides,
  }
}

describe('whose signature a session is', () => {
  it('matches the recipient email to the signed-in account, ignoring case and spacing', () => {
    expect(isSignerEmail('Pat@Example.com', ' pat@example.com ')).toBe(true)
    expect(isSignerEmail('pat@example.com', 'sam@example.com')).toBe(false)
    expect(isSignerEmail('', '')).toBe(false)
    expect(isSignerEmail(null, 'pat@example.com')).toBe(false)
    expect(isSignerEmail('pat@example.com', null)).toBe(false)
  })

  it('lists the client’s own items first and points one item straight at its page', () => {
    const own = signature()
    const spouse = signature({ sessionId: '22222222-2222-4222-8222-222222222222', recipientName: 'Sam Smith', recipientEmail: 'sam@example.com', mine: false })
    const summary = summarisePendingSignatures([spouse, own])
    expect(summary.mine).toEqual([own])
    expect(summary.others).toEqual([spouse])
    expect(summary.href).toBe(portalSigningHref(own.sessionId))
    expect(summarisePendingSignatures([own, signature({ sessionId: '33333333-3333-4333-8333-333333333333' })]).href).toBe('/documents#sign')
    expect(summarisePendingSignatures([spouse]).href).toBe('/documents#sign')
  })
})

describe('how a pending signature reads', () => {
  it('names an engagement as the client’s agreement and a document by its own title', () => {
    expect(signatureTitle(signature())).toBe('Your engagement agreement')
    expect(signatureTitle(signature({ kind: 'document', label: 'HIPAA Authorization' }))).toBe('HIPAA Authorization')
    expect(signatureTitle(signature({ kind: 'document', label: '  ' }))).toBe('Document to sign')
    expect(signatureNoun('engagement')).toBe('agreement')
    expect(signatureNoun('document')).toBe('document')
  })

  it('tells the client how long they have, and who else it waits on', () => {
    const now = new Date('2026-10-06T12:00:00Z')
    expect(signatureStatusLine(signature(), now)).toBe('Sent Oct 3 · available for 14 more days.')
    expect(signatureStatusLine(signature({ expiresAt: '2026-10-08T06:00:00Z' }), now)).toBe('Sent Oct 3 · available until tomorrow.')
    expect(signatureStatusLine(signature({ expiresAt: '2026-10-07T06:00:00Z' }), now)).toBe('Sent Oct 3 · available until later today.')
    expect(signatureStatusLine(signature({ expiresAt: '2026-10-01T00:00:00Z' }), now)).toContain('expired')
    expect(signatureStatusLine(signature({ sentAt: null }), now)).toContain('Ready for you')
    expect(signatureStatusLine(signature({ mine: false, recipientName: 'Sam Smith' }), now)).toBe('Waiting for Sam Smith to sign.')
  })

  it('routes to the portal signing page by session id', () => {
    expect(portalSigningHref('abc')).toBe('/documents/sign/abc')
  })
})

describe('the portal door', () => {
  const route = fs.readFileSync('app/api/documents/sign/[sessionId]/route.ts', 'utf8')
  const server = fs.readFileSync('lib/portal/signaturesServer.ts', 'utf8')

  it('admits only the signed-in client, on their own matter, as the named recipient', () => {
    expect(route).toContain('getBearerUser(req)')
    expect(route).toContain('getMatterForUser(')
    expect(route).toContain('resolvePortalSigningSession(')
    expect(server).toContain("owner.data.matter_id !== input.matterId) return NOT_HERE")
    expect(server).toContain('isSignerEmail(recipient.email, input.userEmail)')
    // A session that is not theirs and one that does not exist read the same.
    expect(server.match(/return NOT_HERE/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  it('gives a closed session the signer’s reason rather than hiding it', () => {
    expect(server).toContain('gateRefusal(session)')
  })

  it('runs the shared flow and never its own copy of the signing', () => {
    expect(route).toContain("from '@/lib/esign/signingFlow'")
    expect(route).not.toContain('sealSignedAgreement')
    expect(route).not.toContain("from('esign_audit_events')")
  })

  it('reads open sessions only, on live parents, addressed by the engine’s own recipient keys', () => {
    expect(server).toContain(".in('status', [...LIVE_PARENT_STATUSES])")
    expect(server).toContain(".in('status', [...OPEN_SIGNING_STATUSES])")
    expect(server).toContain(".gt('expires_at', nowIso)")
    expect(server).toContain('`agreement:${row.agreement_id}:${row.role}`')
    expect(server).toContain('`request:${row.request_id}:${row.recipient_key}`')
  })
})

describe('where signing surfaces in the portal', () => {
  it('lists what awaits a signature on Documents and the dashboard, and signs on its own page', () => {
    const documents = fs.readFileSync('app/(portal)/documents/page.tsx', 'utf8')
    expect(documents).toContain('fetchPortalSignatures(matter.id, user.email ?? null)')
    expect(documents).toContain('<PendingSignatures')

    const dashboard = fs.readFileSync('app/(portal)/dashboard/page.tsx', 'utf8')
    expect(dashboard).toContain('fetchPortalSignatures(matter.id, auth.email ?? null)')
    expect(dashboard).toContain('pendingSignatureCount: pendingSignatures.mine.length')
    expect(dashboard).toContain('Ready for your signature')

    const page = fs.readFileSync('app/(portal)/documents/sign/[sessionId]/page.tsx', 'utf8')
    expect(page).toContain('fetchPortalSignature(matter.id, user.email ?? null, sessionId)')
    expect(page).toContain('if (!signature) notFound()')
    expect(page).toContain('withSession')
    expect(page).toContain('/api/documents/sign/')
  })

  it('keeps the emailed link working through the same component', () => {
    const publicPage = fs.readFileSync('app/sign/[token]/page.tsx', 'utf8')
    expect(publicPage).toContain('endpoint={`/api/sign/${encodeURIComponent(token)}`}')
    const component = fs.readFileSync('components/esign/SigningExperience.tsx', 'utf8')
    expect(component).toContain('fetch(endpoint')
    expect(component).toContain('sessionHeaders(withSession)')
    expect(component).toContain('Sign {noun}')
  })
})

describe('what signing changes on the record', () => {
  it('shares the executed copy of a signed document with the client, as the engagement path does', () => {
    const completion = fs.readFileSync('lib/esign/documentSignature.ts', 'utf8')
    const body = completion.slice(completion.indexOf('export async function completeDocumentSignature'))
    expect(body).toContain('shared_at: now')
    expect(body).toContain('notifyClientOfSharedDocument(matterId, documentName)')
  })

  it('applies the engagement requirement for native signing, not only when Firma is configured', () => {
    const lifecycle = fs.readFileSync('lib/lifecycle/server.ts', 'utf8')
    expect(lifecycle).toContain('async function engagementTracked()')
    expect(lifecycle).toContain('if (isEsignConfigured()) return true')
    expect(lifecycle).toContain('esignNativeEnabled()')
    expect(lifecycle).not.toContain('isEsignConfigured() &&')
    expect(lifecycle).not.toContain('isEsignConfigured()\n    ?')
  })

  it('types the agreement’s filed document', () => {
    const types = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    const block = types.slice(types.indexOf('      engagement_agreements: {'), types.indexOf('      engagement_esign_artifacts: {'))
    expect(block).toContain('document_id: string | null')
    expect(block).toContain('engagement_agreements_document_id_fkey')
  })
})
