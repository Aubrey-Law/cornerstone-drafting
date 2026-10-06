import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESIGN_CONSENT_TEXT, consentTextSha256 } from '@/lib/esign/consent'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

/**
 * The signing route is the one public surface in this engine, and the token in
 * the URL is its only credential. These pin the properties that make that
 * safe, and the ones a refactor could quietly undo.
 *
 * The flow itself (open, consent, sign, seal, file) lives in
 * lib/esign/signingFlow.ts, shared with the portal's door
 * (/api/documents/sign/[sessionId]); the route keeps only what is about the
 * token. So the shape is pinned in two halves: the credential on the route, the
 * signing on the flow.
 */

describe('signing route security shape', () => {
  const route = read('app/api/sign/[token]/route.ts')
  const flow = read('lib/esign/signingFlow.ts')
  // The session row and its open/closed gate, kept free of PDF dependencies.
  const session = read('lib/esign/signingSession.ts')

  it('resolves the session by token hash, never by a raw stored token', () => {
    expect(route).toContain('hashSigningToken(token)')
    expect(route).toContain("eq('token_hash'")
    // Nothing should ever look a session up by an id taken from the body.
    for (const source of [route, flow]) {
      expect(source).not.toContain('body.sessionId')
      expect(source).not.toContain('body.agreementId')
    }
  })

  it('checks expiry and prior outcome through the shared gate', () => {
    expect(route).toContain('gateRefusal')
    expect(session).toContain('signingSessionGate')
  })

  it('tells a signer a withdrawn request was withdrawn, not that it expired', () => {
    // Every other refusal reason has its own branch; without one, `cancelled`
    // falls through to the expiry message and a client who did nothing is told
    // their clock ran out. The precedence itself is pinned in
    // tests/esign-native-tokens.test.ts.
    expect(session).toContain("gate.reason === 'cancelled'")
    expect(session).toContain('withdrawn by the firm')
  })

  it('does not reveal whether a link ever existed', () => {
    // A wrong token and a revoked one must look the same to the holder.
    expect(route).toContain('This signing link is not valid')
  })

  it('refuses to sign without recorded consent', () => {
    expect(flow).toContain('consentAccepted !== true')
    expect(flow).toContain('Electronic signature consent is required')
  })

  it('records consent, signature and sealing as separate audit events', () => {
    for (const event of ['opened', 'consented', 'signed', 'sealed', 'declined']) {
      expect(flow).toContain(`'${event}'`)
    }
  })

  it('treats a failed audit write as fatal to the signing', () => {
    // The audit trail is the evidence. Proceeding without it would produce a
    // signed document the firm cannot account for.
    expect(flow).toContain('Could not record the')
  })

  it('rate limits both public handlers, in their own buckets', () => {
    // `route.toContain('guardPublicSchedulingRoute')` is what this asserted
    // before, and it passed for months while GET was entirely unguarded —
    // POST's call satisfied it. So slice each handler and ask separately.
    for (const handler of ['export async function POST', 'export async function GET']) {
      const start = route.indexOf(handler)
      expect(start, `${handler} is missing`).toBeGreaterThan(-1)
      const opening = route.slice(start, start + 2000)
      expect(opening, `${handler} is not rate limited`).toContain('guardPublicSchedulingRoute(req,')
    }

    // Distinct buckets: a shared counter would let the page's own loads spend
    // the budget the client needs to submit a signature.
    const buckets = [...route.matchAll(/guardPublicSchedulingRoute\(req, '([^']+)'/g)].map(m => m[1])
    expect(buckets).toHaveLength(2)
    expect(new Set(buckets).size).toBe(2)
  })

  it('finishes through the shared completion module, not its own copy', () => {
    expect(flow).toContain('completeWorkspaceAgreement')
    expect(flow).not.toContain("from('matter_documents')")
    expect(route).not.toContain("from('matter_documents')")
  })

  it('offers declining as a real outcome', () => {
    expect(flow).toContain("action === 'decline'")
    expect(flow).toContain("status: 'declined'")
  })

  it('does not derive anchor markers itself', () => {
    // The template numbers signers CLIENT_1/CLIENT_2; the spouse is CLIENT_2.
    // A role-named prefix produced [[SPOUSE_SIGNATURE]], which exists in no
    // template, so the spouse could never sign.
    //
    // The route used to derive its own markers for the one signer in front of
    // it, which is also how it came to seal a two-party agreement with one
    // signature on it. It now hands every signer to sealFieldsFor, which owns
    // the derivation for all of them. That property is asserted on behaviour
    // rather than on this file — tests/esign-seal-fields.test.ts checks that
    // position 2 yields CLIENT_2 — and tests/engagement-anchors.test.ts pins
    // the markers against the real template.
    expect(flow).toContain('sealFieldsFor')
    expect(flow).not.toContain('engagementAnchorMarkers')
    expect(flow).not.toContain('SPOUSE')
  })

  it('seals every signature on the agreement, not just the newest', () => {
    // Each signature rebuilds the sealed file from the approved PDF, which is
    // what keeps one audit certificate on it. Rebuilding with a single signer
    // erased the previous one.
    expect(flow).toContain("eq('status', 'signed')")
    expect(flow).toContain('priorMarks')
  })

  it('dates the signature lines in the firm timezone, not the runtime\'s', () => {
    // The serverless runtime is UTC, so an agreement signed between 8pm and
    // midnight Eastern was stamped with the *following* day's date on its
    // signature line — a term of an executed legal document decided by which
    // machine happened to seal it. sealFieldsFor takes the zone as a required
    // argument now, so this is about the flow handing it the right one: the
    // firm's own, the same zone the scheduler books against.
    expect(flow).toContain('getSchedulingSettings')
    // The zone must be the second argument. Not the last one: sealFieldsFor now
    // takes an optional marker namespace after it, so pinning `timezone)` would
    // fail on a change that leaves this property untouched.
    expect(flow).toMatch(/sealFieldsFor\([\s\S]*?\],\s*timezone[,)]/)
  })

  it('reads its subject through the seam, not from the engagement tables', () => {
    // The route used to query engagement_agreement_recipients directly, which
    // made an engagement agreement the only thing in the app that could be
    // signed. What it signs, who signs it and where the marks go now come from
    // resolveSigningSubject — so a second kind of signable document is a branch
    // in one module rather than a second copy of this route.
    expect(flow).toContain('resolveSigningSubject')
    expect(flow).not.toContain('engagement_agreement_recipients')
    expect(flow).toContain('subject.pdfKey')
    expect(flow).toContain('subject.markersFor')
    expect(flow).toContain('subject.sealedKey')
  })

  it('files audit events against whichever owner the session has', () => {
    // esign_audit_events carries the same exactly-one-owner rule as the
    // sessions table. Hardcoding agreement_id would make every audit write on a
    // non-engagement signing fail the check constraint — at signing time, in
    // front of a client.
    expect(flow).toContain('auditOwner')
    expect(flow).toContain('signature_request_id')
  })

  it('keeps engagement completion to engagements', () => {
    // completeWorkspaceAgreement hires the matter, starts the SLA clock and
    // flips matter_details.engagement_signed. Running it for an arbitrary
    // signed PDF would promote a lead off the back of a HIPAA authorisation.
    expect(flow).toContain("subject.kind === 'engagement'")
  })

  it('refuses to sign rather than guess a signer position', () => {
    // Defaulting to position 1 would stamp this signature on another signer's
    // line and produce an executed agreement that looks finished and is wrong.
    expect(flow).not.toContain('?? 1')
    expect(flow).toContain('recipient not found on agreement')
  })

  it('runs on node, which the sealing step requires', () => {
    expect(route).toContain("runtime = 'nodejs'")
    expect(route).toContain("dynamic = 'force-dynamic'")
  })

  it('is the same flow the portal door runs', () => {
    // Two credentials, one signing path. A second copy of the flow would be a
    // second place for the sealing and audit rules above to drift.
    const portal = read('app/api/documents/sign/[sessionId]/route.ts')
    for (const source of [route, portal]) {
      expect(source).toContain("from '@/lib/esign/signingFlow'")
      expect(source).toContain('openSigningSession(')
      expect(source).toContain('submitSigning(')
      expect(source).not.toContain('sealSignedAgreement')
    }
  })
})

describe('signing page is deliberately public', () => {
  it('is not in the proxy matcher, so no session is demanded', () => {
    // The matcher is an explicit allowlist. Adding /sign to it would make the
    // proxy redirect an unauthenticated client to a login page they have no
    // account for — the link would simply stop working.
    const proxy = read('proxy.ts')
    const matcher = proxy.slice(proxy.indexOf('matcher: ['))
    expect(matcher).not.toContain("'/sign")
    expect(matcher).not.toContain("'/api/sign")
  })

  it('holds nothing sensitive itself', () => {
    const page = read('app/sign/[token]/page.tsx')
    expect(page).not.toContain('getAdminClient')
    expect(page).not.toContain('SUPABASE')
  })
})

describe('consent disclosure', () => {
  it('is one shared constant, so the hash attests to what was shown', () => {
    // If the page and the flow could hold different wording, the recorded
    // hash would describe text nobody read.
    const flow = read('lib/esign/signingFlow.ts')
    expect(flow).toContain('ESIGN_CONSENT_TEXT')
    expect(flow).toContain('consentTextSha256()')
  })

  it('covers what ESIGN and UETA require a signer to be told', () => {
    const text = ESIGN_CONSENT_TEXT.toLowerCase()
    expect(text).toContain('electronically')
    expect(text).toContain('same legal effect')
    expect(text).toContain('paper copy')
    expect(text).toContain('withdraw')
    expect(text).toContain('download or print')
  })

  it('hashes deterministically, and differently for revised wording', () => {
    expect(consentTextSha256()).toBe(consentTextSha256(ESIGN_CONSENT_TEXT))
    expect(consentTextSha256()).toMatch(/^[a-f0-9]{64}$/)
    expect(consentTextSha256(`${ESIGN_CONSENT_TEXT} `)).not.toBe(consentTextSha256())
  })
})
