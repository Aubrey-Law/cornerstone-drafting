import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveSigningSubject } from '@/lib/esign/subject'
import { gateRefusal, loadSigningSessionById, type SigningSessionRow } from '@/lib/esign/signingSession'
import {
  isSignerEmail,
  LIVE_PARENT_STATUSES,
  OPEN_SIGNING_STATUSES,
  type PortalSignature,
} from '@/lib/portal/signatures'

/**
 * Signing from the portal: the reads.
 *
 * Everything the portal shows about signing is derived from the native engine's
 * own rows (engagement agreements, signature requests, their recipients and
 * their sessions), so there is one state for a signature however it is reached.
 * Reads run through the admin client after the caller has established that the
 * matter belongs to the signed-in client; nothing here is reachable without
 * that.
 */

type SessionRow = {
  id: string
  agreement_id: string | null
  signature_request_id: string | null
  recipient_key: string
  status: string
  expires_at: string
  created_at: string
}

function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

/**
 * Every open signing session on a matter, with who it is addressed to and
 * whether that is the signed-in client. Own sessions first, then by send time.
 */
export async function fetchPortalSignatures(
  matterId: string,
  userEmail: string | null,
  client: SupabaseClient = getAdminClient(),
): Promise<PortalSignature[]> {
  const [agreements, requests] = await Promise.all([
    client
      .from('engagement_agreements')
      .select('id, status, sent_at')
      .eq('matter_id', matterId)
      .in('status', [...LIVE_PARENT_STATUSES]),
    client
      .from('signature_requests')
      .select('id, name, status, sent_at')
      .eq('matter_id', matterId)
      .in('status', [...LIVE_PARENT_STATUSES]),
  ])
  if (agreements.error && !isMissingTable(agreements.error)) throw new Error(agreements.error.message)
  if (requests.error && !isMissingTable(requests.error)) throw new Error(requests.error.message)

  const agreementRows = (agreements.data ?? []) as Array<{ id: string; status: string; sent_at: string | null }>
  const requestRows = (requests.data ?? []) as Array<{ id: string; name: string; status: string; sent_at: string | null }>
  if (agreementRows.length === 0 && requestRows.length === 0) return []

  const agreementIds = agreementRows.map(row => row.id)
  const requestIds = requestRows.map(row => row.id)
  const sessionFilters: string[] = []
  if (agreementIds.length > 0) sessionFilters.push(`agreement_id.in.(${agreementIds.join(',')})`)
  if (requestIds.length > 0) sessionFilters.push(`signature_request_id.in.(${requestIds.join(',')})`)

  const nowIso = new Date().toISOString()
  const { data: sessions, error: sessionError } = await client
    .from('esign_signing_sessions')
    .select('id, agreement_id, signature_request_id, recipient_key, status, expires_at, created_at')
    .or(sessionFilters.join(','))
    .in('status', [...OPEN_SIGNING_STATUSES])
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: true })
  if (sessionError) {
    if (isMissingTable(sessionError)) return []
    throw new Error(sessionError.message)
  }
  const sessionRows = (sessions ?? []) as SessionRow[]
  if (sessionRows.length === 0) return []

  const [agreementRecipients, requestRecipients] = await Promise.all([
    agreementIds.length > 0
      ? client
        .from('engagement_agreement_recipients')
        .select('agreement_id, role, name, email')
        .in('agreement_id', agreementIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length > 0
      ? client
        .from('signature_request_recipients')
        .select('request_id, recipient_key, name, email')
        .in('request_id', requestIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (agreementRecipients.error) throw new Error(agreementRecipients.error.message)
  if (requestRecipients.error) throw new Error(requestRecipients.error.message)

  // Recipient rows are keyed the way sessions name them: an agreement's by
  // role (primary, spouse), a request's by its positional recipient_key.
  const recipientByKey = new Map<string, { name: string; email: string }>()
  for (const row of (agreementRecipients.data ?? []) as Array<{ agreement_id: string; role: string; name: string; email: string }>) {
    recipientByKey.set(`agreement:${row.agreement_id}:${row.role}`, { name: row.name, email: row.email })
  }
  for (const row of (requestRecipients.data ?? []) as Array<{ request_id: string; recipient_key: string; name: string; email: string }>) {
    recipientByKey.set(`request:${row.request_id}:${row.recipient_key}`, { name: row.name, email: row.email })
  }
  const requestById = new Map(requestRows.map(row => [row.id, row]))
  const agreementById = new Map(agreementRows.map(row => [row.id, row]))

  const signatures: PortalSignature[] = []
  for (const session of sessionRows) {
    const owner = session.agreement_id
      ? { kind: 'engagement' as const, id: session.agreement_id, label: 'engagement agreement', sentAt: agreementById.get(session.agreement_id)?.sent_at ?? null }
      : session.signature_request_id
        ? { kind: 'document' as const, id: session.signature_request_id, label: requestById.get(session.signature_request_id)?.name ?? 'document', sentAt: requestById.get(session.signature_request_id)?.sent_at ?? null }
        : null
    if (!owner) continue
    const recipient = recipientByKey.get(`${owner.kind === 'engagement' ? 'agreement' : 'request'}:${owner.id}:${session.recipient_key}`)
    if (!recipient) continue
    signatures.push({
      sessionId: session.id,
      kind: owner.kind,
      label: owner.label,
      status: session.status as 'sent' | 'viewed',
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      mine: isSignerEmail(recipient.email, userEmail),
      sentAt: owner.sentAt ?? session.created_at,
      expiresAt: session.expires_at,
    })
  }
  return signatures.sort((a, b) => Number(b.mine) - Number(a.mine))
}

/**
 * The one session the signed-in client may sign from the portal, or null when
 * it is not on their matter, not addressed to them, or no longer open. The
 * caller has already established that `matterId` is the client's own.
 */
export async function fetchPortalSignature(
  matterId: string,
  userEmail: string | null,
  sessionId: string,
): Promise<PortalSignature | null> {
  const signatures = await fetchPortalSignatures(matterId, userEmail)
  return signatures.find(signature => signature.sessionId === sessionId && signature.mine) ?? null
}

const NOT_HERE = { ok: false as const, status: 404, error: 'This document is not available to sign here' }

/**
 * Vet a session the portal wants to open or sign.
 *
 * Three checks, each run every time: the session exists; whatever it signs
 * belongs to the client's own matter; and the recipient it was sent to is the
 * email the client signs in with. A session that fails any of them gets one
 * answer, so the id in the URL tells a guesser nothing. One that passes but is
 * no longer open gets the signer-facing reason (already signed, withdrawn,
 * expired), the same words the emailed link would show.
 */
export async function resolvePortalSigningSession(input: {
  sessionId: string
  matterId: string
  userEmail: string | null
}): Promise<{ ok: true; session: SigningSessionRow } | { ok: false; status: number; error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.sessionId)) return NOT_HERE
  const session = await loadSigningSessionById(input.sessionId)
  if (!session) return NOT_HERE

  const subject = await resolveSigningSubject(session)
  const admin = getAdminClient()
  const owner = subject.kind === 'engagement'
    ? await admin.from('engagement_agreements').select('matter_id').eq('id', subject.ownerId).maybeSingle()
    : await admin.from('signature_requests').select('matter_id').eq('id', subject.ownerId).maybeSingle()
  if (owner.error) throw new Error(owner.error.message)
  if (!owner.data || owner.data.matter_id !== input.matterId) return NOT_HERE

  const recipient = subject.recipients.find(entry => entry.key === session.recipient_key)
  if (!recipient || !isSignerEmail(recipient.email, input.userEmail)) return NOT_HERE

  const refusal = gateRefusal(session)
  if (refusal) return refusal
  return { ok: true, session }
}
