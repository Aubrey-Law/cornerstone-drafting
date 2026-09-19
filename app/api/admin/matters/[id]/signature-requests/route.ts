import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getR2Client, r2Bucket } from '@/lib/r2'
import {
  createDocumentSignatureRequest,
  esignDocumentsEnabled,
  DocumentSignatureError,
} from '@/lib/esign/documentSignature'
import { SignaturePageError } from '@/lib/esign/signaturePage'
import { AnchorLocationError } from '@/lib/esign/nativeAnchors'
import { deriveRequestState } from '@/lib/esign/requestStatus'
import type { SignatureRequestSigner, SignatureRequestSummary } from '@/lib/esign/requestStatus'
import { isUuid } from '@/lib/queries/tasks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/matters/[id]/signature-requests
 *
 * Send a PDF already in this matter's documents out for signature. The upload
 * itself is the existing one — /api/documents/upload — so this takes a
 * matter_documents id rather than a file.
 *
 * Flag-gated on firm_settings.esign_documents_enabled, which fails closed.
 */

interface SignerPayload {
  name?: unknown
  email?: unknown
  role?: unknown
}

function parseSigners(input: unknown): Array<{ name: string; email: string; role?: string }> {
  if (!Array.isArray(input)) return []
  return input.flatMap((raw: SignerPayload) => {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    const email = typeof raw?.email === 'string' ? raw.email.trim() : ''
    if (!name || !email) return []
    const role = typeof raw?.role === 'string' && raw.role.trim() ? raw.role.trim() : undefined
    return [{ name, email, ...(role ? { role } : {}) }]
  })
}

/**
 * GET /api/admin/matters/[id]/signature-requests
 *
 * What this matter has out for signature, and how far each one has got. The
 * send is a POST that returns once and says nothing afterwards, so without this
 * a sent document looks exactly like an unsent one until the executed PDF turns
 * up in the documents list days later.
 *
 * Per-signer progress comes from esign_signing_sessions rather than
 * signature_request_recipients: the signing route maintains the sessions, and
 * the recipient rows are inserted once and never updated.
 *
 * Nothing here carries a token or a token hash. The signing link is a
 * credential, and this endpoint exists to be read in a browser.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id: matterId } = await params

  // Same gate as the send, so a firm without the feature never sees a badge for
  // something it cannot do. An empty list rather than a 403: the documents tab
  // asks for this on every load and a refusal is not an error worth showing.
  if (!isUuid(matterId) || !(await esignDocumentsEnabled())) {
    return NextResponse.json({ requests: [] })
  }

  const admin = getAdminClient()

  const { data: requestRows, error: requestError } = await admin
    .from('signature_requests')
    .select('id, name, source_document_id, status, sent_at, completed_at, provider_sync_error, created_at')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
  if (requestError) {
    return NextResponse.json({ error: 'Could not load signature requests' }, { status: 500 })
  }
  if (!requestRows || requestRows.length === 0) return NextResponse.json({ requests: [] })

  const requestIds = requestRows.map(row => String(row.id))
  const [recipientResult, sessionResult] = await Promise.all([
    admin
      .from('signature_request_recipients')
      .select('request_id, recipient_key, recipient_order, name, email')
      .in('request_id', requestIds)
      .order('recipient_order', { ascending: true }),
    admin
      .from('esign_signing_sessions')
      .select('signature_request_id, recipient_key, status, expires_at, viewed_at, signed_at, declined_at')
      .in('signature_request_id', requestIds),
  ])
  if (recipientResult.error || sessionResult.error) {
    return NextResponse.json({ error: 'Could not load signature requests' }, { status: 500 })
  }

  const sessionsByRequest = new Map<string, Map<string, Record<string, unknown>>>()
  for (const session of sessionResult.data ?? []) {
    const requestId = String(session.signature_request_id)
    const byKey = sessionsByRequest.get(requestId) ?? new Map()
    byKey.set(String(session.recipient_key), session as Record<string, unknown>)
    sessionsByRequest.set(requestId, byKey)
  }

  const now = new Date()
  const requests: SignatureRequestSummary[] = requestRows.map(row => {
    const requestId = String(row.id)
    const sessions = sessionsByRequest.get(requestId) ?? new Map()
    const signers: SignatureRequestSigner[] = (recipientResult.data ?? [])
      .filter(recipient => String(recipient.request_id) === requestId)
      .map(recipient => {
        const session = sessions.get(String(recipient.recipient_key))
        return {
          name: String(recipient.name),
          email: String(recipient.email),
          // No session means the send threw before minting one, which is a
          // different thing from a link that was sent and ignored.
          state: session ? String(session.status) : 'pending',
          viewedAt: (session?.viewed_at as string | null) ?? null,
          signedAt: (session?.signed_at as string | null) ?? null,
          declinedAt: (session?.declined_at as string | null) ?? null,
        }
      })

    const derived = deriveRequestState(
      { status: String(row.status) },
      [...sessions.values()].map(session => ({
        status: String(session.status),
        expires_at: (session.expires_at as string | null) ?? null,
      })),
      now,
    )

    return {
      id: requestId,
      name: String(row.name),
      sourceDocumentId: (row.source_document_id as string | null) ?? null,
      state: derived.state,
      signedCount: derived.signedCount,
      // Recipients are the roll; a send that failed before minting sessions
      // still has signers, so the count comes from them rather than the joins.
      signerCount: signers.length || derived.signerCount,
      sentAt: (row.sent_at as string | null) ?? null,
      completedAt: (row.completed_at as string | null) ?? null,
      error: (row.provider_sync_error as string | null) ?? null,
      signers,
    }
  })

  return NextResponse.json({ requests })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await esignDocumentsEnabled())) {
    return NextResponse.json(
      { error: 'Sending documents for signature is not enabled for this firm' },
      { status: 403 },
    )
  }

  const { id: matterId } = await params

  let body: {
    documentId?: unknown
    name?: unknown
    signers?: unknown
    message?: unknown
    expirationHours?: unknown
    ceremonyAttested?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // The G.L. c. 190B gate, checked before anything else happens. The database
  // refuses to let a request leave draft without the attestation; this refuses
  // to create one at all, and says why in words an attorney can act on.
  if (body.ceremonyAttested !== true) {
    return NextResponse.json({
      error: 'Confirm this document needs no witnessed or notarized signing ceremony before sending it',
    }, { status: 400 })
  }

  const documentId = typeof body.documentId === 'string' ? body.documentId : ''
  if (!documentId) return NextResponse.json({ error: 'Choose a document to send' }, { status: 400 })

  const signers = parseSigners(body.signers)
  if (signers.length === 0) {
    return NextResponse.json({ error: 'Add at least one signer, with a name and an email' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Scoped to this matter deliberately: the document id comes from the request
  // body, so it is checked against the matter in the URL rather than trusted.
  const { data: document, error: documentError } = await admin
    .from('matter_documents')
    .select('id, matter_id, r2_key, name, content_type')
    .eq('id', documentId)
    .maybeSingle()
  if (documentError) {
    return NextResponse.json({ error: 'Could not load that document' }, { status: 500 })
  }
  if (!document || String(document.matter_id) !== matterId) {
    return NextResponse.json({ error: 'That document is not part of this matter' }, { status: 404 })
  }
  if (String(document.content_type) !== 'application/pdf') {
    return NextResponse.json(
      { error: 'Only a PDF can be sent for signature' },
      { status: 400 },
    )
  }

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: r2Bucket(), Key: String(document.r2_key) }),
    { expiresIn: 300 },
  )
  const response = await fetch(url)
  if (!response.ok) {
    return NextResponse.json({ error: 'Could not read that document' }, { status: 502 })
  }
  const sourcePdf = Buffer.from(await response.arrayBuffer())

  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim()
    : String(document.name).replace(/\.pdf$/i, '')

  try {
    const result = await createDocumentSignatureRequest({
      matterId,
      sourceDocumentId: String(document.id),
      name,
      sourcePdf,
      sourceR2Key: String(document.r2_key),
      signers,
      message: typeof body.message === 'string' ? body.message : '',
      expirationHours: typeof body.expirationHours === 'number' && body.expirationHours > 0
        ? body.expirationHours
        : 168,
      attestedBy: auth.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    // These three name a cause the sender can do something about — a document
    // that already carries markers, an anchor that would not resolve, or a
    // rejected input. Anything else is ours and stays a 500.
    if (
      error instanceof DocumentSignatureError
      || error instanceof SignaturePageError
      || error instanceof AnchorLocationError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[signature-requests] send failed', error)
    return NextResponse.json({ error: 'Could not send this document for signature' }, { status: 500 })
  }
}
