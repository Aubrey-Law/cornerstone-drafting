import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ESIGN_CONSENT_TEXT, consentTextSha256 } from '@/lib/esign/consent'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

/**
 * The signing route is the one public surface in this engine, and the token in
 * the URL is its only credential. These pin the properties that make that
 * safe, and the ones a refactor could quietly undo.
 */

describe('signing route security shape', () => {
  const route = read('app/api/sign/[token]/route.ts')

  it('resolves the session by token hash, never by a raw stored token', () => {
    expect(route).toContain('hashSigningToken(token)')
    expect(route).toContain("eq('token_hash'")
    // Nothing should ever look a session up by an id taken from the body.
    expect(route).not.toContain('body.sessionId')
    expect(route).not.toContain('body.agreementId')
  })

  it('checks expiry and prior outcome through the shared gate', () => {
    expect(route).toContain('signingSessionGate')
  })

  it('does not reveal whether a link ever existed', () => {
    // A wrong token and a revoked one must look the same to the holder.
    expect(route).toContain('This signing link is not valid')
  })

  it('refuses to sign without recorded consent', () => {
    expect(route).toContain('consentAccepted !== true')
    expect(route).toContain('Electronic signature consent is required')
  })

  it('records consent, signature and sealing as separate audit events', () => {
    for (const event of ['opened', 'consented', 'signed', 'sealed', 'declined']) {
      expect(route).toContain(`'${event}'`)
    }
  })

  it('treats a failed audit write as fatal to the signing', () => {
    // The audit trail is the evidence. Proceeding without it would produce a
    // signed document the firm cannot account for.
    expect(route).toContain('Could not record the')
  })

  it('rate limits the public endpoint', () => {
    expect(route).toContain('guardPublicSchedulingRoute')
  })

  it('finishes through the shared completion module, not its own copy', () => {
    expect(route).toContain('completeWorkspaceAgreement')
    expect(route).not.toContain("from('matter_documents')")
  })

  it('offers declining as a real outcome', () => {
    expect(route).toContain("action === 'decline'")
    expect(route).toContain("status: 'declined'")
  })

  it('runs on node, which the sealing step requires', () => {
    expect(route).toContain("runtime = 'nodejs'")
    expect(route).toContain("dynamic = 'force-dynamic'")
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
    // If the page and the route could hold different wording, the recorded
    // hash would describe text nobody read.
    const route = read('app/api/sign/[token]/route.ts')
    expect(route).toContain('ESIGN_CONSENT_TEXT')
    expect(route).toContain('consentTextSha256()')
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
