import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { intakeTrackLabel, normalizeIntakeTrack } from '@/lib/intakeTrack'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Switch which questionnaire an intake serves.
 *
 * Attorney-only on purpose: the track decides what questions the client is
 * asked, so it is not part of the client-facing `/api/intake` write path.
 * Switching after submission would silently re-validate answers against a
 * question set the client never saw, so that is refused.
 */
export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({})) as { intakeId?: unknown; track?: unknown }
  const intakeId = typeof body.intakeId === 'string' ? body.intakeId.trim() : ''
  const track = normalizeIntakeTrack(body.track)

  if (!intakeId) return NextResponse.json({ error: 'intakeId is required' }, { status: 400 })
  if (!track) return NextResponse.json({ error: 'Unknown intake track' }, { status: 400 })

  const admin = getAdminClient()
  const { data: intake, error: fetchError } = await admin
    .from('client_intake')
    .select('id, status, intake_track, lead_status, form_version_id')
    .eq('id', intakeId)
    .maybeSingle()

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!intake) return NextResponse.json({ error: 'Intake not found' }, { status: 404 })

  if (intake.form_version_id != null && intake.intake_track !== track) {
    return NextResponse.json({ error: 'This intake uses a saved questionnaire version. Its track cannot be changed.' }, { status: 409 })
  }

  if (intake.status === 'submitted' || intake.status === 'approved') {
    return NextResponse.json(
      { error: 'This intake has been submitted. Unlock it before changing the questionnaire.' },
      { status: 409 },
    )
  }

  if (intake.intake_track === track) return NextResponse.json({ intake_track: track })

  const { error: updateError } = await admin
    .from('client_intake')
    .update({ intake_track: track, updated_at: new Date().toISOString() })
    .eq('id', intakeId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  if (intake.lead_status) {
    try {
      await admin.from('lead_activity').insert({
        lead_id: intakeId,
        event_type: 'intake_track_changed',
        actor_id: userId,
        title: 'Intake questionnaire changed',
        detail: `Now using the ${intakeTrackLabel(track)} questionnaire.`,
      })
    } catch (error) {
      console.error('[intake track] lead activity insert failed:', error)
    }
  }

  return NextResponse.json({ intake_track: track })
}
