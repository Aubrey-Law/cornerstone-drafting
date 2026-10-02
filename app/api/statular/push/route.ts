import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { IntegrationError } from '@/lib/integrations/errors'
import { syncStatularClient } from '@/lib/integrations/statular/clients'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorStatus(error: IntegrationError): number {
  switch (error.code) {
    case 'configuration_required': return 503
    case 'invalid_source_data': return 422
    case 'validation_failed': return 422
    case 'rate_limited': return 429
    case 'idempotency_conflict': return 409
    default: return error.kind === 'retryable' ? 503 : 502
  }
}

/**
 * POST /api/statular/push { intakeId } — create this lead's Statular client now,
 * or return the one already linked. Staff-initiated, so it does not wait for
 * the fit decision or the sync toggle; Statular cannot update or delete, so a
 * repeat push reuses the stored client instead of creating another.
 */
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { intakeId?: unknown } | null
  const intakeId = typeof body?.intakeId === 'string' ? body.intakeId.trim() : ''
  if (!UUID.test(intakeId)) return NextResponse.json({ error: 'A valid intakeId is required' }, { status: 400 })

  try {
    const result = await syncStatularClient(intakeId)
    if (result.operation === 'created') {
      const { error: activityError } = await getAdminClient().from('lead_activity').insert({
        lead_id: intakeId,
        event_type: 'statular_pushed',
        title: 'Created in Statular',
        detail: `Statular client ${result.externalId}`,
        actor_id: userId,
      })
      if (activityError) console.error('[statular/push] activity log failed', activityError.code ?? 'unknown')
    }
    return NextResponse.json({ statularClientId: result.externalId, operation: result.operation })
  } catch (error) {
    // Only the safe surface leaves: the webhook URL is the credential, and
    // payload values are client PII.
    if (error instanceof IntegrationError) {
      return NextResponse.json({ error: error.safeMessage, code: error.code }, { status: errorStatus(error) })
    }
    console.error('[statular/push] unexpected failure', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Push to Statular failed' }, { status: 500 })
  }
}
