import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { normalizePracticeArea, practiceAreaLabel, practiceAreaMatterCode } from '@/lib/practiceArea'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'

async function generateSimpleMatterNumber(
  admin: ReturnType<typeof getAdminClient>,
  practiceArea: string,
): Promise<string> {
  const year = new Date().getFullYear()
  const code = practiceAreaMatterCode(practiceArea)
  const prefix = `${year}-${code}-`

  const { data } = await admin
    .from('matters')
    .select('matter_number')
    .like('matter_number', `${prefix}%`)
    .order('matter_number', { ascending: false })
    .limit(1)

  const last = data?.[0]?.matter_number as string | undefined
  const lastSeq = last ? Number.parseInt(last.slice(prefix.length), 10) : 0
  const next = Number.isFinite(lastSeq) ? lastSeq + 1 : 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
  const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim().toLowerCase() : ''
  const clientPhone = typeof body.clientPhone === 'string' ? body.clientPhone.trim() : null
  const planType = body.planType

  if (!clientName || !clientEmail) {
    return NextResponse.json({ error: 'clientName and clientEmail are required' }, { status: 400 })
  }

  const practiceArea = normalizePracticeArea(planType)
  const practiceAreaName = practiceAreaLabel(practiceArea)
  const admin = getAdminClient()

  const { data: clientUser } = await admin
    .from('users')
    .select('id')
    .eq('email', clientEmail)
    .maybeSingle()

  const nameParts = clientName.split(/\s+/)
  const first_name = nameParts[0] ?? clientName
  const last_name = nameParts.slice(1).join(' ') || null

  const { data: intake, error: intakeError } = await admin
    .from('client_intake')
    .insert({
      email: clientEmail,
      first_name,
      last_name,
      full_name: clientName,
      phone: clientPhone,
      practice_area: practiceArea,
      status: 'in_progress',
      user_id: clientUser?.id ?? null,
      client_user_id: clientUser?.id ?? null,
    })
    .select('id')
    .single()

  if (intakeError || !intake) {
    return NextResponse.json(
      { error: `Failed to create intake record: ${intakeError?.message ?? 'unknown'}` },
      { status: 500 },
    )
  }

  const matterNumber = await generateSimpleMatterNumber(admin, practiceArea)
  const now = new Date().toISOString()

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .insert({
      client_intake_id: intake.id,
      client_id: clientUser?.id ?? null,
      name: `${clientName} — ${practiceAreaName}`,
      matter_number: matterNumber,
      stage: 'intake',
      status: 'active',
      stage_entered_at: now,
      track: 'DEFAULT',
    })
    .select('id')
    .single()

  if (matterError || !matter) {
    return NextResponse.json(
      { error: `Failed to create matter: ${matterError?.message ?? 'unknown'}` },
      { status: 500 },
    )
  }

  await admin
    .from('client_intake')
    .update({ matter_id: matter.id })
    .eq('id', intake.id)

  const { error: detailsError } = await admin.from('matter_details').upsert(
    {
      client_id: matter.id,
      practice_area: practiceArea,
      plan_type: 'TBD',
      matter_status: 'Active',
      client_status: 'active',
      jurisdiction_state: 'MA',
      matter_number: matterNumber,
    },
    { onConflict: 'client_id' },
  )

  if (detailsError) {
    return NextResponse.json(
      { error: `Failed to create matter details: ${detailsError.message}` },
      { status: 500 },
    )
  }

  try {
    await ensureDesignSheetSeededFromIntake(matter.id)
  } catch (e) {
    console.warn('design sheet seed on create skipped:', e)
  }

  try {
    await admin.from('matter_activity').insert({
      matter_id: matter.id,
      event_type: 'matter_created',
      title: 'Matter created',
      detail: `${clientName} (${clientEmail})`,
      actor_id: userId,
    })
  } catch (e) {
    console.warn('matter_activity skipped:', e)
  }

  return NextResponse.json({ matterId: matter.id, matterNumber })
}
