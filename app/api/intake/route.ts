import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient, ADMIN_EMAIL } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { saveHouseholdContact } from '@/lib/contacts/saveHouseholdContact'
import { reconcileHouseholdChildren } from '@/lib/contacts/reconcileHouseholdChildren'
import { getBearerToken } from '@/lib/apiAuth'
import {
  findClientIntakeForUser,
  getOrCreateClientIntakeForUser,
} from '@/lib/intake/getOrCreateClientIntake'

function makeUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

function dateOrNull(val: unknown) {
  return typeof val === 'string' && val.trim() ? val : null
}

const STEP_ID_TO_NUM: Record<string, number> = {
  personal: 1,
  family: 2,
  fiduciaries: 3,
  review: 4,
}

/** Lite schema stores current_step as text — keep step ids when provided. */
function normalizeStep(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined
  if (typeof val === 'string') {
    if (STEP_ID_TO_NUM[val]) return val
    const n = parseInt(val, 10)
    if (!isNaN(n)) return String(n)
    return val
  }
  if (typeof val === 'number') return String(val)
  return undefined
}

async function notifyIntakeComplete(
  clientName: string,
  clientEmail: string,
  matterId: string | null,
): Promise<void> {
  await sendEmail({
    category: 'intake_complete_alert',
    to: ADMIN_EMAIL,
    replyTo: clientEmail || undefined,
    subject: `Intake complete: ${clientName}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">Intake questionnaire submitted</h2>
      <p><strong>${clientName}</strong> (${clientEmail}) has completed their intake questionnaire.</p>
      ${matterId ? `<p style="color:#64748b;font-size:12px">Matter ID: ${matterId}</p>` : ''}
    </div>`,
  })
}

function buildIntakePayload(body: Record<string, unknown>, userId: string) {
  const notes =
    (typeof body.special_notes === 'string' ? body.special_notes : undefined) ??
    (typeof body.additional_notes === 'string' ? body.additional_notes : undefined) ??
    (typeof body.notes === 'string' ? body.notes : undefined)

  return {
    user_id: userId,
    status: body.status,
    current_step: normalizeStep(body.current_step),
    first_name: body.first_name,
    middle_name: body.middle_name,
    last_name: body.last_name,
    preferred_name: body.preferred_name,
    preferred_pronoun: body.preferred_pronoun,
    full_name: body.full_name,
    date_of_birth: dateOrNull(body.date_of_birth),
    is_us_citizen: body.is_us_citizen,
    phone: body.phone,
    email: body.email,
    address_line1: body.address_line1,
    address_line2: body.address_line2,
    city: body.city,
    state: body.state,
    zip: body.zip,
    county: body.county,
    marital_status: body.marital_status,
    has_minor_children: body.has_minor_children ?? body.has_children,
    marriage_date: dateOrNull(body.marriage_date ?? body.date_of_marriage),
    goals: body.goals ?? body.planning_goals,
    fiduciary_entries: body.fiduciary_entries ?? body.fiduciaries,
    family_details: body.family_details,
    financial_details: body.financial_details,
    notes,
  }
}

// GET /api/intake — authenticated client intake row
export async function GET(req: Request) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = makeUserClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const intake = await getOrCreateClientIntakeForUser(sb, user)
    return NextResponse.json(intake)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load intake'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/intake — save / submit authenticated client intake (no leads)
export async function POST(req: Request) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = makeUserClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as Record<string, unknown>
  const existingId = body.existingId as string | undefined
  const ownedOrClause = `user_id.eq.${user.id},client_user_id.eq.${user.id}`

  const payload = buildIntakePayload(body, user.id)
  const cleanPayload = formatPhoneFieldsDeep(
    Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)),
  )

  // Reject writes against an already-submitted intake.
  {
    const lookupId = existingId
    let currentStatus: string | null | undefined
    if (lookupId) {
      const { data: existingRow } = await sb
        .from('client_intake')
        .select('status')
        .eq('id', lookupId)
        .or(ownedOrClause)
        .maybeSingle()
      currentStatus = existingRow?.status as string | null | undefined
    } else {
      const existing = await findClientIntakeForUser(sb, user.id)
      currentStatus = existing?.status as string | null | undefined
    }
    if (currentStatus === 'submitted' || currentStatus === 'approved') {
      return NextResponse.json(
        { error: 'Intake is locked. Contact your attorney to make changes.' },
        { status: 409 },
      )
    }
  }

  let recordId: string

  if (existingId) {
    const { data: updated, error } = await sb
      .from('client_intake')
      .update(cleanPayload)
      .eq('id', existingId)
      .or(ownedOrClause)
      .select('id')
    if (error) {
      console.error('[intake POST] update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!updated?.length) {
      return NextResponse.json(
        { error: 'Intake not found or you do not have access to save this questionnaire.' },
        { status: 403 },
      )
    }
    recordId = existingId
  } else {
    const existing = await findClientIntakeForUser(sb, user.id)
    if (existing?.id) {
      const { error } = await sb
        .from('client_intake')
        .update(cleanPayload)
        .eq('id', existing.id as string)
      if (error) {
        console.error('[intake POST] update (fallback) error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      recordId = existing.id as string
    } else {
      const { data, error } = await sb
        .from('client_intake')
        .insert(cleanPayload)
        .select('id')
        .single()
      if (error) {
        console.error('[intake POST] insert error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      recordId = data.id as string
    }
  }

  // Spouse lives in contacts (single source of truth).
  {
    const spouseFirst = typeof body.spouse_first_name === 'string' ? body.spouse_first_name.trim() : ''
    const spouseLast = typeof body.spouse_last_name === 'string' ? body.spouse_last_name.trim() : ''
    if (spouseFirst || spouseLast) {
      try {
        const admin = getAdminClient()
        await saveHouseholdContact(admin, {
          householdId: recordId,
          relationship_type: 'spouse',
          first_name: spouseFirst,
          last_name: spouseLast,
          middle_name: typeof body.spouse_middle_name === 'string' ? body.spouse_middle_name : null,
          date_of_birth: dateOrNull(body.spouse_date_of_birth),
          is_us_citizen: typeof body.spouse_is_us_citizen === 'boolean' ? body.spouse_is_us_citizen : null,
          email: typeof body.spouse_email === 'string' ? body.spouse_email : null,
          phone: typeof body.spouse_phone === 'string' ? body.spouse_phone : null,
          source: 'client',
        })
      } catch (e) {
        console.error('[intake POST] spouse contact save error:', e)
      }
    }
  }

  if (Array.isArray(body.children)) {
    try {
      const admin = getAdminClient()
      await reconcileHouseholdChildren(admin, recordId, body.children as Array<Record<string, unknown>>)
    } catch (e) {
      console.error('[intake POST] children contact save error:', e)
    }
  }

  if (body.status === 'submitted') {
    let admin: ReturnType<typeof getAdminClient>
    try {
      admin = getAdminClient()
    } catch (e) {
      console.error('[intake POST] admin client unavailable:', e)
      return NextResponse.json({ id: recordId })
    }

    await admin
      .from('client_intake')
      .update({ intake_completed_at: new Date().toISOString() })
      .eq('id', recordId)

    const { data: existingMatter } = await admin
      .from('matters')
      .select('id, stage')
      .eq('client_intake_id', recordId)
      .maybeSingle()

    if (existingMatter) {
      if (existingMatter.stage === 'intake') {
        const { error: stageError } = await admin
          .from('matters')
          .update({
            stage: 'intake_review',
            intake_submitted_at: new Date().toISOString(),
            stage_entered_at: new Date().toISOString(),
          })
          .eq('id', existingMatter.id)
          .eq('stage', 'intake')

        if (stageError) {
          console.error('[intake POST] stage advance error:', stageError)
        }
      } else {
        await admin
          .from('matters')
          .update({ intake_submitted_at: new Date().toISOString() })
          .eq('id', existingMatter.id)
      }

      try {
        await ensureDesignSheetSeededFromIntake(existingMatter.id as string)
      } catch (e) {
        console.error('[intake POST] design sheet seed error:', e)
      }
    }

    const clientName =
      [body.first_name, body.last_name].filter(Boolean).join(' ') || 'Client'
    const clientEmail =
      (typeof body.email === 'string' ? body.email : null) ?? user.email ?? ''
    void notifyIntakeComplete(clientName, clientEmail, existingMatter?.id ?? null).catch(
      (err) => console.error('[intake POST] notify error:', err),
    )
  }

  return NextResponse.json({ id: recordId })
}
