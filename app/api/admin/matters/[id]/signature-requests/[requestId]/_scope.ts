import 'server-only'

import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { esignDocumentsEnabled } from '@/lib/esign/documentLifecycle'
import { isUuid } from '@/lib/queries/tasks'

/**
 * The flag and the scope check both cancel and resend need.
 *
 * The request id arrives in the URL, so it is checked against the matter in
 * the URL rather than trusted — the same treatment the send route gives a
 * document id it is handed in a body. Without it, any admin could cancel any
 * matter's request by guessing an id.
 *
 * Authentication deliberately stays in each route rather than moving here: an
 * admin route that does not say `requireAdmin` in its own source is one nobody
 * can check by reading it, and tests/api-route-auth.test.ts says so.
 */
export async function scopeRequestToMatter(matterId: string, requestId: string): Promise<
  | { ok: true }
  | { ok: false; response: NextResponse }
> {
  if (!(await esignDocumentsEnabled())) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Sending documents for signature is not enabled for this firm' },
        { status: 403 },
      ),
    }
  }

  if (!isUuid(matterId) || !isUuid(requestId)) {
    return { ok: false, response: NextResponse.json({ error: 'That signature request is not part of this matter' }, { status: 404 }) }
  }

  const { data: request, error } = await getAdminClient()
    .from('signature_requests')
    .select('id, matter_id')
    .eq('id', requestId)
    .maybeSingle()
  if (error) {
    return { ok: false, response: NextResponse.json({ error: 'Could not load that signature request' }, { status: 500 }) }
  }
  if (!request || String(request.matter_id) !== matterId) {
    return { ok: false, response: NextResponse.json({ error: 'That signature request is not part of this matter' }, { status: 404 }) }
  }

  return { ok: true }
}
