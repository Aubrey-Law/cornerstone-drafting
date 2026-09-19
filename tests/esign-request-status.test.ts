import { describe, expect, it } from 'vitest'
import { deriveRequestState } from '@/lib/esign/requestStatus'

/**
 * What a signature request is actually doing.
 *
 * signature_requests.status only ever holds draft, sent, completed or failed —
 * nothing writes viewed or partially_signed, and signature_request_recipients
 * is inserted once and never updated. The live truth is in
 * esign_signing_sessions, which the signing route does maintain. So the badge
 * an attorney reads is derived here rather than taken from the column, and
 * these cases are the reason that distinction matters.
 */

const NOW = new Date('2026-09-19T12:00:00Z')
const LATER = '2026-09-26T12:00:00Z'
const PAST = '2026-09-12T12:00:00Z'

function session(status: string, expiresAt: string | null = LATER) {
  return { status, expires_at: expiresAt }
}

describe('deriveRequestState', () => {
  it('counts signers whatever the state', () => {
    const result = deriveRequestState({ status: 'sent' }, [session('signed'), session('sent')], NOW)
    expect(result.signedCount).toBe(1)
    expect(result.signerCount).toBe(2)
  })

  it('is partially signed when one of two has signed', () => {
    // The column says `sent` in this case and always will. Reading it would
    // tell an attorney chasing a second signature that nobody had signed.
    const { state } = deriveRequestState({ status: 'sent' }, [session('signed'), session('sent')], NOW)
    expect(state).toBe('partially_signed')
  })

  it('is signed when every session is, even before completion has run', () => {
    // completeDocumentSignature flips the column, but it runs after the last
    // signature and can fail. Both signers being done is the fact.
    expect(deriveRequestState({ status: 'sent' }, [session('signed'), session('signed')], NOW).state)
      .toBe('signed')
    expect(deriveRequestState({ status: 'completed' }, [session('signed')], NOW).state).toBe('signed')
  })

  it('reports a failed send over anything the sessions say', () => {
    // A send that threw after the row existed leaves status `failed` with the
    // reason on the row. Sessions may well have been created first.
    expect(deriveRequestState({ status: 'failed' }, [session('sent')], NOW).state).toBe('failed')
  })

  it('reports a decline, which no session count would show', () => {
    expect(deriveRequestState({ status: 'sent' }, [session('signed'), session('declined')], NOW).state)
      .toBe('declined')
  })

  it('reports an expired link, by its date as well as its status', () => {
    // Nothing sweeps expiry, so a session sits at `sent` with a past
    // expires_at. To the attorney it is a dead link either way.
    expect(deriveRequestState({ status: 'sent' }, [session('sent', PAST)], NOW).state).toBe('expired')
    expect(deriveRequestState({ status: 'sent' }, [session('expired')], NOW).state).toBe('expired')
  })

  it('does not call a finished request expired because a stale link went past its date', () => {
    // A signed session keeps its original expires_at, which goes into the past
    // like any other. The document is signed; the date is irrelevant.
    expect(deriveRequestState({ status: 'sent' }, [session('signed', PAST)], NOW).state).toBe('signed')
    expect(deriveRequestState({ status: 'sent' }, [session('signed', PAST), session('sent')], NOW).state)
      .toBe('partially_signed')
  })

  it('reports a view before anyone has signed', () => {
    expect(deriveRequestState({ status: 'sent' }, [session('viewed'), session('sent')], NOW).state)
      .toBe('viewed')
  })

  it('says sent when it has only been sent', () => {
    expect(deriveRequestState({ status: 'sent' }, [session('sent'), session('sent')], NOW).state)
      .toBe('sent')
  })

  it('does not claim a draft was sent', () => {
    // A row can be left at draft if the process dies between the insert and
    // the update that sends it. Nobody was emailed; saying "out for signature"
    // would send an attorney looking for a link that was never minted.
    expect(deriveRequestState({ status: 'draft' }, [], NOW).state).toBe('draft')
  })

  it('does not claim a cancelled request is still out', () => {
    expect(deriveRequestState({ status: 'cancelled' }, [session('sent')], NOW).state).toBe('cancelled')
  })
})
