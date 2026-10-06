import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { signingSessionGate } from '@/lib/esign/nativeTokens'

/**
 * A signing session as the doors to the flow see it: the row, and whether it
 * can still be used. Kept apart from lib/esign/signingFlow.ts, which pulls in
 * the PDF sealer, so that the portal's listing and authorisation can read
 * sessions without bundling pdf.js into every page that shows them.
 */

export type SigningSessionRow = {
  id: string
  /** Exactly one of these is set; the database enforces it. */
  agreement_id: string | null
  signature_request_id: string | null
  recipient_key: string
  status: string
  expires_at: string
}

export const SIGNING_SESSION_COLUMNS = 'id, agreement_id, signature_request_id, recipient_key, status, expires_at'

export type SigningRefusal = { ok: false; status: number; error: string }

/**
 * Why a stored session can no longer be used, in the signer's terms.
 *
 * A withdrawn session is named as withdrawn: saying it expired would blame the
 * signer for a clock that never ran out, and leave them with nothing to do
 * about it.
 */
export function gateRefusal(session: Pick<SigningSessionRow, 'status' | 'expires_at'>): SigningRefusal | null {
  const gate = signingSessionGate(session)
  if (gate.ok) return null
  const message = gate.reason === 'already_signed'
    ? 'This agreement has already been signed'
    : gate.reason === 'declined'
      ? 'This agreement was declined'
      : gate.reason === 'cancelled'
        ? 'This request was withdrawn by the firm. Please contact us if you think this is a mistake.'
        : 'This signing link has expired'
  return { ok: false, status: 410, error: message }
}

/** A session by its id, for a caller that has already established who is asking. */
export async function loadSigningSessionById(sessionId: string): Promise<SigningSessionRow | null> {
  const { data, error } = await getAdminClient()
    .from('esign_signing_sessions')
    .select(SIGNING_SESSION_COLUMNS)
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as SigningSessionRow | null) ?? null
}
