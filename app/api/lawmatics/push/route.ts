import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { IntegrationError } from '@/lib/integrations/errors'
import { LawmaticsValidationError } from '@/lib/integrations/lawmatics/validation'
import { pushLeadToLawmatics } from '@/lib/integrations/lawmatics/push'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorStatus(error: IntegrationError): number {
  switch (error.code) {
    case 'identity_required': return 422
    case 'authentication_required': return 401
    case 'rate_limited': return 429
    case 'integration_busy': return 409
    case 'create_outcome_unknown': return 409
    default: return error.kind === 'retryable' ? 503 : 502
  }
}

/**
 * POST /api/lawmatics/push { intakeId } — create the lead's Lawmatics prospect,
 * or update it when Cornerstone is already linked to one.
 */
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { intakeId?: unknown } | null
  const intakeId = typeof body?.intakeId === 'string' ? body.intakeId.trim() : ''
  if (!UUID.test(intakeId)) return NextResponse.json({ error: 'A valid intakeId is required' }, { status: 400 })

  try {
    const result = await pushLeadToLawmatics(intakeId)
    const { error: activityError } = await getAdminClient().from('lead_activity').insert({
      lead_id: intakeId,
      event_type: 'lawmatics_pushed',
      title: result.operation === 'created' ? 'Created in Lawmatics' : 'Updated in Lawmatics',
      detail: `${result.sent.length} field${result.sent.length === 1 ? '' : 's'} sent`
        + (result.rejected.length ? `; refused by Lawmatics: ${result.rejected.join(', ')}` : ''),
      actor_id: userId,
    })
    if (activityError) console.error('[lawmatics/push] activity log failed', activityError.message)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof LawmaticsValidationError) {
      // Lawmatics' wording goes back to the staff member who pushed; it is not logged or stored.
      const reason = error.details.length ? ` ${error.details.join(' ')}` : ''
      return NextResponse.json({ error: `${error.safeMessage}${reason}`, code: error.code, fields: error.fields,
        details: error.details }, { status: 422 })
    }
    if (error instanceof IntegrationError) {
      return NextResponse.json({ error: error.safeMessage, code: error.code }, { status: errorStatus(error) })
    }
    console.error('[lawmatics/push] unexpected failure', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Push to Lawmatics failed' }, { status: 500 })
  }
}
