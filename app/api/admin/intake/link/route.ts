import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  ensureStandingIntakeLink,
  revokeStandingIntakeLink,
  rotateStandingIntakeLink,
} from '@/lib/intake/standingLinks'
import { getAdminClient } from '@/lib/supabaseAdmin'

async function intakeIdFromRequest(req: NextRequest): Promise<string> {
  if (req.method === 'GET') return req.nextUrl.searchParams.get('intakeId')?.trim() ?? ''
  const body = await req.json().catch(() => ({})) as { intakeId?: unknown }
  return typeof body.intakeId === 'string' ? body.intakeId.trim() : ''
}

async function verifyLead(intakeId: string) {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('client_intake')
    .select('id')
    .eq('id', intakeId)
    .not('lead_status', 'is', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? admin : null
}

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const intakeId = await intakeIdFromRequest(req)
  if (!intakeId) return NextResponse.json({ error: 'intakeId is required' }, { status: 400 })
  try {
    const admin = await verifyLead(intakeId)
    if (!admin) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    return NextResponse.json(await ensureStandingIntakeLink(admin, intakeId, false))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not prepare intake link' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const intakeId = await intakeIdFromRequest(req)
  if (!intakeId) return NextResponse.json({ error: 'intakeId is required' }, { status: 400 })
  try {
    const admin = await verifyLead(intakeId)
    if (!admin) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const link = await rotateStandingIntakeLink(admin, intakeId)
    await admin.from('lead_activity').insert({
      lead_id: intakeId,
      event_type: 'intake_link_rotated',
      actor_id: userId,
      title: 'Intake link replaced',
      detail: 'The previous standing link was invalidated.',
    })
    return NextResponse.json(link)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not replace intake link' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const intakeId = await intakeIdFromRequest(req)
  if (!intakeId) return NextResponse.json({ error: 'intakeId is required' }, { status: 400 })
  try {
    const admin = await verifyLead(intakeId)
    if (!admin) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const result = await revokeStandingIntakeLink(admin, intakeId)
    await admin.from('lead_activity').insert({
      lead_id: intakeId,
      event_type: 'intake_link_revoked',
      actor_id: userId,
      title: 'Intake link revoked',
      detail: 'The standing link can no longer be used.',
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not revoke intake link' },
      { status: 500 },
    )
  }
}
