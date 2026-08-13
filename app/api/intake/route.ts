import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient, ADMIN_EMAIL } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { appUrl } from '@/lib/urls'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'
import { intakePayloadTouchesLead, syncLeadFromIntake } from '@/lib/syncLeadFromIntake'
import { getSubmissionErrors, type IntakeRow } from '@/lib/intakeSections'
import { getIntakeReadinessFlags, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { seedDesignSheetAndJobs } from '@/lib/intakeSeed'
import { resolveIntakeByInviteToken } from '@/lib/intake/standingLinks'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { saveHouseholdContact } from '@/lib/contacts/saveHouseholdContact'
import { reconcileHouseholdChildren } from '@/lib/contacts/reconcileHouseholdChildren'
import { saveAdditionalContacts } from '@/lib/contacts/saveAdditionalContacts'
import { persistFiduciaryRoles } from '@/lib/contacts/persistFiduciaryRoles'
import {
  fiduciaryEntriesToRoles,
  fiduciaryEntriesTouchesManagedRoles,
} from '@/lib/contacts/fiduciaryEntriesToRoles'
import {
  hydrateIntakeWithContacts,
  intakeAdditionalContactsFromRequestBody,
  intakeChildrenFromRequestBody,
  intakeExcludedGuardianTextFromRequestBody,
  overlayRequestContactIntakeData,
} from '@/lib/intakeContactHydration'
import { getOrCreateClientIntakeForUser } from '@/lib/intake/getOrCreateClientIntake'
import { optionalDateOrNull } from '@/lib/intakeRequestValues'
import { getBearerToken } from '@/lib/apiAuth'

const ADMIN_NOTIFY_EMAIL = ADMIN_EMAIL

type SupabaseAdminClient = ReturnType<typeof getAdminClient>

async function notifyIntakeComplete(clientName: string, clientEmail: string, matterId: string | null): Promise<void> {
  const matterLink = matterId ? appUrl(`/admin/matters/${matterId}?tab=overview`) : appUrl('/admin/matters')
  await sendEmail({
    category: 'intake_complete_alert',
    to: ADMIN_NOTIFY_EMAIL,
    replyTo: clientEmail,
    subject: `Intake complete: ${clientName}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <h2 style="margin:0 0 12px">Intake questionnaire submitted</h2>
      <p><strong>${clientName}</strong> (${clientEmail}) has completed their intake questionnaire.</p>
      <p><a href="${matterLink}" style="color:#1a6b72">View matter →</a></p>
    </div>`,
  })
}

function makeUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

// Lite schema stores current_step as text (step id strings from GuidedInterview).
const STEP_NUM_TO_ID: Record<number, string> = {
  1: 'referral',
  2: 'personal',
  3: 'family',
  4: 'spouse',
  5: 'children',
  6: 'estate',
  7: 'goals',
  8: 'additional_contacts',
  9: 'fiduciaries',
  10: 'spouse_fiduciaries',
  11: 'guardian',
  12: 'review',
}

const STEP_ID_TO_NUM: Record<string, number> = Object.fromEntries(
  Object.entries(STEP_NUM_TO_ID).map(([n, id]) => [id, Number(n)]),
) as Record<string, number>

function normalizeStep(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined
  if (typeof val === 'string') {
    if (STEP_ID_TO_NUM[val]) return val
    const n = parseInt(val, 10)
    if (!isNaN(n) && STEP_NUM_TO_ID[n]) return STEP_NUM_TO_ID[n]
    return val
  }
  if (typeof val === 'number' && STEP_NUM_TO_ID[val]) return STEP_NUM_TO_ID[val]
  return undefined
}

async function recordInviteUse(
  admin: SupabaseAdminClient,
  intakeId: string,
  eventType: string,
  req: Request,
): Promise<void> {
  try {
    await admin.from('intake_invite_audit').insert({
      client_intake_id: intakeId,
      event_type: eventType,
      ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: req.headers.get('user-agent'),
    })
    await admin
      .from('client_intake')
      .update({ intake_token_last_used_at: new Date().toISOString() })
      .eq('id', intakeId)
  } catch (error) {
    console.error('[intake invite audit] failed:', error)
  }
}

// GET /api/intake — authenticated client intake row (hydrated with contacts)
export async function GET(req: Request) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = makeUserClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const intake = await getOrCreateClientIntakeForUser(sb, user)
    const admin = getAdminClient()
    const hydrated = await hydrateIntakeWithContacts(
      admin,
      intake as Record<string, unknown>,
      intake.id as string,
    )
    return NextResponse.json(hydrated)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load intake'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  const publicIntakeToken = req.headers.get('x-intake-token')

  // ── Public token auth path ─────────────────────────────────────────────────
  // Used by legacy public-token saves and invite-authenticated intake pages.
  // Validates the invite token against the DB; no Supabase user session needed.
  if (publicIntakeToken) {
    const admin = getAdminClient()
    const tokenRow = await resolveIntakeByInviteToken(admin, publicIntakeToken)

    if (!tokenRow) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }
    if (tokenRow.user_id || tokenRow.client_user_id) {
      return NextResponse.json({ error: 'Sign in to continue this intake' }, { status: 401 })
    }
    await recordInviteUse(admin, tokenRow.id as string, 'api_token_save', req)

    if (tokenRow.status === 'submitted' || tokenRow.status === 'approved') {
      return NextResponse.json(
        { error: 'Intake is locked. Contact your attorney to make changes.' },
        { status: 409 },
      )
    }

    const body = await req.json()
    const existingId: string = tokenRow.id  // always use the row found by token
    const excludedGuardian = intakeExcludedGuardianTextFromRequestBody(body)

    // Build payload — omit user_id (already set on the row)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPayload: Record<string, any> = {
      status:                   body.status,
      current_step:             normalizeStep(body.current_step),
      first_name:               body.first_name,
      middle_name:              body.middle_name,
      last_name:                body.last_name,
      suffix:                   body.suffix,
      prior_names:              body.prior_names,
      preferred_name:           body.preferred_name,
      preferred_pronoun:        body.preferred_pronoun,
      full_name:                body.full_name,
      date_of_birth:            optionalDateOrNull(body.date_of_birth),
      is_us_citizen:            body.is_us_citizen,
      phone:                    body.phone,
      email:                    body.email,
      address_line1:            body.address_line1,
      address_line2:            body.address_line2,
      city:                     body.city,
      state:                    body.state,
      zip:                      body.zip,
      county:                   body.county,
      marital_status:           body.marital_status,
      has_children:             body.has_children,
      has_minor_children:       body.has_minor_children,
      date_of_marriage:         optionalDateOrNull(body.date_of_marriage),
      estate_value:             body.estate_value,
      has_real_property:        body.has_real_property,
      has_retirement:           body.has_retirement,
      has_investments:          body.has_investments,
      has_business:             body.has_business,
      has_life_insurance:       body.has_life_insurance,
      has_ltc_insurance:        body.has_ltc_insurance,
      has_existing_plan:        body.has_existing_plan,
      has_major_illness:        body.has_major_illness,
      has_family_disability:    body.has_family_disability,
      has_prior_gift_tax:       body.has_prior_gift_tax,
      is_trust_beneficiary:     body.is_trust_beneficiary,
      has_divorce_settlement:   body.has_divorce_settlement,
      planning_goals:           body.planning_goals ?? body.goals,
      planning_objectives:      body.planning_objectives,
      fiduciaries:              body.fiduciaries,
      // Omitted on the status-only final submit request. Leave it undefined so
      // validation and the update preserve the choices saved by autosave.
      review_choices:           body.review_choices,
      spouse_as_fiduciary:      body.spouse_as_fiduciary,
      excluded_guardian:        excludedGuardian,
      excluded_guardian_2:      body.excluded_guardian_2,
      special_notes:            body.special_notes ?? body.additional_notes,
      family_details:           body.family_details,
      other_individuals:        body.other_individuals,
      financial_details:        body.financial_details,
      // Attorney-set plan structure + document selection (Guided Interview,
      // attorney mode). Dormant for client-mode saves (clients never send them).
      plan_type:                body.plan_type,
      document_inclusions:      body.document_inclusions,
      // College Preparation Plan answers, packed by useAutoSave. The track
      // itself is attorney-set (see /api/admin/intake/track) and deliberately
      // not writable here.
      college_prep_details:     body.college_prep_details,
    }

    // On final submit, record completion timestamp and advance matter stage
    if (body.status === 'submitted') {
      rawPayload.intake_completed_at = new Date().toISOString()
    }

    const cleanPayload = formatPhoneFieldsDeep(Object.fromEntries(
      Object.entries(rawPayload).filter(([, v]) => v !== undefined)
    ))

    let reviewFlags: IntakeReadinessFlag[] = []
    if (body.status === 'submitted') {
      let hydratedForSubmit: Record<string, unknown>
      try {
        hydratedForSubmit = await hydrateIntakeWithContacts(admin, { ...tokenRow, ...cleanPayload }, existingId)
      } catch (error) {
        console.error('[intake POST token] hydrate for submit failed:', error)
        return NextResponse.json({ error: 'Could not validate intake for submission.' }, { status: 500 })
      }
      const mergedForSubmit = overlayRequestContactIntakeData(
        hydratedForSubmit,
        body,
      ) as IntakeRow
      const submitErrors = getSubmissionErrors(mergedForSubmit)
      if (submitErrors.length > 0) {
        return NextResponse.json(
          { error: 'Intake is incomplete', issues: submitErrors },
          { status: 422 },
        )
      }
      reviewFlags = getIntakeReadinessFlags(mergedForSubmit)
      cleanPayload.attorney_review_flags = reviewFlags
    }

    const { error: updateError } = await admin
      .from('client_intake')
      .update(cleanPayload)
      .eq('id', existingId)

    if (updateError) {
      console.error('[intake POST token] update error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Spouse lives in contacts (single source of truth), not on client_intake.
    const spouseFirst = typeof body.spouse_first_name === 'string' ? body.spouse_first_name.trim() : ''
    const spouseLast  = typeof body.spouse_last_name  === 'string' ? body.spouse_last_name.trim()  : ''
    if (spouseFirst || spouseLast) {
      await saveHouseholdContact(admin, {
        householdId:        existingId,
        relationship_type:  'spouse',
        first_name:         spouseFirst,
        last_name:          spouseLast,
        middle_name:        typeof body.spouse_middle_name    === 'string' ? body.spouse_middle_name    : null,
        suffix:             typeof body.spouse_suffix         === 'string' ? body.spouse_suffix         : null,
        preferred_name:     typeof body.spouse_preferred_name === 'string' ? body.spouse_preferred_name : null,
        prior_names:        typeof body.spouse_prior_names    === 'string' ? body.spouse_prior_names    : null,
        preferred_pronoun:  typeof body.spouse_preferred_pronoun === 'string' ? body.spouse_preferred_pronoun : null,
        date_of_birth:      optionalDateOrNull(body.spouse_date_of_birth),
        is_us_citizen:      typeof body.spouse_is_us_citizen === 'boolean' ? body.spouse_is_us_citizen : null,
        email:              typeof body.spouse_email === 'string' ? body.spouse_email : null,
        phone:              typeof body.spouse_phone === 'string' ? body.spouse_phone : null,
        source:             'client',
      })
    }

    const children = intakeChildrenFromRequestBody(body)
    if (children) {
      try {
        await reconcileHouseholdChildren(admin, existingId, children)
      } catch (e) {
        console.error('[intake POST token] children contact save error:', e)
      }
    }

    const additionalContacts = intakeAdditionalContactsFromRequestBody(body)
    if (additionalContacts) {
      try {
        await saveAdditionalContacts(admin, existingId, additionalContacts)
      } catch (e) {
        console.error('[intake POST token] additional contacts save error:', e)
      }
    }

    // Materialize fiduciary entries into contacts + contact_roles. The JSONB
    // column above is kept as a write-through mirror; F4 will drop it.
    // Non-fatal: a transient contact_roles failure shouldn't block intake
    // submission — same pattern as saveHouseholdChildren above.
    try {
      const fiduciaryRoles = fiduciaryEntriesToRoles(body.fiduciary_entries)
      if (fiduciaryRoles.length > 0 || fiduciaryEntriesTouchesManagedRoles(body.fiduciary_entries)) {
        await persistFiduciaryRoles(admin, existingId, fiduciaryRoles)
      }
    } catch (e) {
      console.error('[intake POST token] fiduciary roles persist error:', e)
    }

    if (intakePayloadTouchesLead(cleanPayload)) {
      void syncLeadFromIntake(admin, { intakeId: existingId, fields: cleanPayload })
        .catch((err) => console.error('[intake POST token] lead sync error:', err))
    }

    // Advance the linked matter from intake → intake_review on submission
    if (body.status === 'submitted') {
      const { data: matter } = await admin
        .from('matters')
        .select('id, stage, relationship_status')
        .eq('client_intake_id', existingId)
        .maybeSingle()

      if (matter?.relationship_status === 'hired' && matter.stage === 'intake') {
        const { data: advanced } = await admin
          .from('matters')
          .update({
            stage: 'intake_review',
            intake_submitted_at: new Date().toISOString(),
            stage_entered_at: new Date().toISOString(),
          })
          .eq('id', matter.id)
          .eq('stage', 'intake')
          .select('id')
          .maybeSingle()

        if (advanced) {
          await admin.from('matter_activity').insert({
            matter_id: matter.id,
            event_type: 'intake_completed',
            title: 'Intake submitted',
            detail: 'Client submitted intake questionnaire',
          })
        }
      }

      await seedDesignSheetAndJobs(admin, {
        intakeId: existingId,
        matterId: (matter?.id as string | undefined) ?? null,
        reviewFlags,
      })

      const clientName = [body.first_name, body.last_name].filter(Boolean).join(' ') || 'Client'
      const clientEmail = typeof body.email === 'string' ? body.email : ''
      const matterId = (matter as { id?: string } | null)?.id ?? null
      void notifyIntakeComplete(clientName, clientEmail, matterId)
        .catch((err) => console.error('[intake POST token] notify error:', err))
      try {
        revalidateSidebarCounts()
      } catch (err) {
        console.error('[intake POST token] sidebar revalidate failed:', err)
      }
    }

    return NextResponse.json({ id: existingId })
  }

  // ── Bearer token auth path (existing behavior) ─────────────────────────────
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = makeUserClient(token)
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const existingId = body.existingId
  const excludedGuardian = intakeExcludedGuardianTextFromRequestBody(body)

  /** Invited questionnaires link the client via `client_user_id`; drafts may use `user_id` alone. */
  const ownedOrClause = `user_id.eq.${user.id},client_user_id.eq.${user.id}`

  const payload = {
    user_id:                  user.id,
    status:                   body.status,
    // Stored as integer for now; see migration note above
    current_step:             normalizeStep(body.current_step),

    // ── Personal ────────────────────────────────────────────────────────────
    first_name:               body.first_name,
    middle_name:              body.middle_name,
    last_name:                body.last_name,
    suffix:                   body.suffix,
    prior_names:              body.prior_names,
    preferred_name:           body.preferred_name,
    preferred_pronoun:        body.preferred_pronoun,
    full_name:                body.full_name,
    date_of_birth:            optionalDateOrNull(body.date_of_birth),
    is_us_citizen:            body.is_us_citizen,
    phone:                    body.phone,
    email:                    body.email,
    address_line1:            body.address_line1,
    address_line2:            body.address_line2,
    city:                     body.city,
    state:                    body.state,
    zip:                      body.zip,
    county:                   body.county,

    // ── Family ───────────────────────────────────────────────────────────────
    marital_status:           body.marital_status,
    has_children:             body.has_children,
    has_minor_children:       body.has_minor_children,
    // has_pets is stored inside family_details JSONB — no dedicated column needed

    // ── Spouse ───────────────────────────────────────────────────────────────
    // NOTE: all spouse fields (including spouse_name) are no longer written to
    // client_intake. Spouse data is stored exclusively in `contacts` via
    // saveHouseholdContact (see below).
    date_of_marriage:         optionalDateOrNull(body.date_of_marriage),

    // ── Estate ───────────────────────────────────────────────────────────────
    // NOTE: add these columns to client_intake if not present:
    //   estate_value text, has_real_property boolean, has_retirement boolean,
    //   has_investments boolean, has_business boolean, has_life_insurance boolean,
    //   has_ltc_insurance boolean, has_existing_plan boolean,
    //   has_major_illness boolean, has_family_disability boolean,
    //   has_prior_gift_tax boolean, is_trust_beneficiary boolean,
    //   has_divorce_settlement boolean
    estate_value:             body.estate_value,
    has_real_property:        body.has_real_property,
    has_retirement:           body.has_retirement,
    has_investments:          body.has_investments,
    has_business:             body.has_business,
    has_life_insurance:       body.has_life_insurance,
    has_ltc_insurance:        body.has_ltc_insurance,
    has_existing_plan:        body.has_existing_plan,
    has_major_illness:        body.has_major_illness,
    has_family_disability:    body.has_family_disability,
    has_prior_gift_tax:       body.has_prior_gift_tax,
    is_trust_beneficiary:     body.is_trust_beneficiary,
    has_divorce_settlement:   body.has_divorce_settlement,

    // ── Goals ────────────────────────────────────────────────────────────────
    // NOTE: add `planning_goals text[]` to client_intake if not present
    planning_goals:           body.planning_goals ?? body.goals,
    // Legacy field kept for backward compat
    planning_objectives:      body.planning_objectives,

    // ── Fiduciaries ──────────────────────────────────────────────────────────
    fiduciaries:              body.fiduciaries,
    // Omitted on the status-only final submit request. Leave it undefined so
    // validation and the update preserve the choices saved by autosave.
    review_choices:           body.review_choices,
    spouse_as_fiduciary:      body.spouse_as_fiduciary,

    // ── Guardian ─────────────────────────────────────────────────────────────
    // NOTE: add `excluded_guardian text, excluded_guardian_2 text` if not present
    excluded_guardian:        excludedGuardian,
    excluded_guardian_2:      body.excluded_guardian_2,

    // ── Misc ─────────────────────────────────────────────────────────────────
    special_notes:            body.special_notes ?? body.additional_notes,
    family_details:           body.family_details,
    other_individuals:        body.other_individuals,

    // ── Financial detail modals (packed JSONB) ────────────────────────────────
    // NOTE: add `financial_details jsonb` to client_intake if not present:
    //   ALTER TABLE client_intake ADD COLUMN IF NOT EXISTS financial_details jsonb;
    financial_details:        body.financial_details,

    // ── Plan structure + documents (Guided Interview, attorney mode) ──────────
    // Attorney-set on the client's intake; seeded into the design sheet by
    // buildIntakeSeedPayload / buildIntakeSeedDecisions
    // (lib/designSheet/seedFromIntake.ts). Clients never send these.
    plan_type:                body.plan_type,
    document_inclusions:      body.document_inclusions,

    // ── College Preparation Plan ─────────────────────────────────────────────
    // All track-specific answers ride one JSONB column; the track itself is
    // attorney-set (see /api/admin/intake/track) and not writable here.
    college_prep_details:     body.college_prep_details,
  }

  // Strip undefined values — Supabase treats undefined keys as null which can
  // overwrite existing data unexpectedly. Only send keys the client actually provided.
  const cleanPayload = formatPhoneFieldsDeep(Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined)
  ))
  let reviewFlags: IntakeReadinessFlag[] = []

  // Reject writes against an already-submitted intake. Attorney must unlock
  // first via the admin UI (sets status back to 'draft').
  let existingForSubmit: Record<string, unknown> | null = null
  {
    const lookupId = existingId as string | undefined
    let currentStatus: string | null | undefined
    if (lookupId) {
      const { data: existingRow, error: existingRowError } = await sb
        .from('client_intake')
        .select('*')
        .eq('id', lookupId)
        .or(ownedOrClause)
        .maybeSingle()
      if (existingRowError) throw new Error(existingRowError.message)
      currentStatus = existingRow?.status as string | null | undefined
      existingForSubmit = existingRow as Record<string, unknown> | null
    } else {
      // Multiple intake rows per user is a legitimate state (re-invite, second
      // engagement), and `.maybeSingle()` *errors* on more than one row.
      // Swallowing that error made this read as "no intake": it skipped the
      // submitted-lock check below and let the save insert yet another row.
      // Ordering matches findClientIntakeForUser (oldest row is canonical).
      const { data: existingRows, error: existingRowError } = await sb
        .from('client_intake')
        .select('*')
        .or(ownedOrClause)
        .order('created_at', { ascending: true })
        .limit(1)
      if (existingRowError) throw new Error(existingRowError.message)
      const existingRow = existingRows?.[0] ?? null
      currentStatus = existingRow?.status as string | null | undefined
      existingForSubmit = existingRow as Record<string, unknown> | null
    }
    if (currentStatus === 'submitted' || currentStatus === 'approved') {
      return NextResponse.json(
        { error: 'Intake is locked. Contact your attorney to make changes.' },
        { status: 409 },
      )
    }
    if (body.status === 'submitted') {
      let admin: ReturnType<typeof getAdminClient>
      try {
        admin = getAdminClient()
      } catch (error) {
        console.error('[intake POST] admin client unavailable for submit validation:', error)
        return NextResponse.json(
          { error: 'Intake submission is temporarily unavailable. Please try again or contact the firm.' },
          { status: 503 },
        )
      }

      let hydratedForSubmit: Record<string, unknown>
      try {
        hydratedForSubmit = await hydrateIntakeWithContacts(
          admin,
          { ...(existingForSubmit ?? {}), ...cleanPayload },
          (existingForSubmit?.id as string | undefined) ?? existingId,
        )
      } catch (error) {
        console.error('[intake POST] hydrate for submit failed:', error)
        return NextResponse.json({ error: 'Could not validate intake for submission.' }, { status: 500 })
      }

      const mergedForSubmit = overlayRequestContactIntakeData(
        hydratedForSubmit,
        body,
      ) as IntakeRow
      const submitErrors = getSubmissionErrors(mergedForSubmit)
      if (submitErrors.length > 0) {
        return NextResponse.json(
          { error: 'Intake is incomplete', issues: submitErrors },
          { status: 422 },
        )
      }
      reviewFlags = getIntakeReadinessFlags(mergedForSubmit)
      cleanPayload.attorney_review_flags = reviewFlags
    }
  }

  let recordId: string

  if (existingId) {
    // UPDATE by known record ID
    const { data: updated, error } = await sb
      .from('client_intake')
      .update(cleanPayload)
      .eq('id', existingId)
      .or(ownedOrClause)
      .select('id')
    if (error) {
      console.error('[intake POST] update error:', error)
      return NextResponse.json({ error: error.message, details: error.details, hint: error.hint }, { status: 500 })
    }
    if (!updated?.length) {
      return NextResponse.json(
        { error: 'Intake not found or you do not have access to save this questionnaire.' },
        { status: 403 },
      )
    }
    recordId = existingId

    if (intakePayloadTouchesLead(cleanPayload)) {
      try {
        const admin = getAdminClient()
        await syncLeadFromIntake(admin, { intakeId: recordId, fields: cleanPayload })
      } catch (e) {
        console.error('[intake POST] lead sync error:', e)
      }
    }
  } else {
    // No existingId — check if a record already exists for this user
    // (handles the case where the client lost track of the record ID)
    // `.maybeSingle()` errors when the user already has more than one intake
    // row; swallowing that error meant this fell through to the INSERT below and
    // added a further row on *every* autosave. Ordering matches
    // findClientIntakeForUser so we update the same row the GET reads.
    const { data: existingRows, error: existingError } = await sb
      .from('client_intake')
      .select('id')
      .or(ownedOrClause)
      .order('created_at', { ascending: true })
      .limit(1)

    if (existingError) {
      console.error('[intake POST] existing lookup error:', existingError)
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }
    const existing = existingRows?.[0] ?? null

    if (existing) {
      // UPDATE the found record
      const { error } = await sb
        .from('client_intake')
        .update(cleanPayload)
        .eq('id', existing.id)
      if (error) {
        console.error('[intake POST] update (fallback) error:', error)
        return NextResponse.json({ error: error.message, details: error.details, hint: error.hint }, { status: 500 })
      }
      recordId = existing.id

      if (intakePayloadTouchesLead(cleanPayload)) {
        try {
          const admin = getAdminClient()
          await syncLeadFromIntake(admin, { intakeId: recordId, fields: cleanPayload })
        } catch (e) {
          console.error('[intake POST] lead sync error:', e)
        }
      }
    } else {
      // INSERT new record
      const { data, error } = await sb
        .from('client_intake')
        .insert(cleanPayload)
        .select('id')
        .single()
      if (error) {
        console.error('[intake POST] insert error:', error)
        return NextResponse.json({ error: error.message, details: error.details, hint: error.hint }, { status: 500 })
      }
      recordId = data.id

      if (intakePayloadTouchesLead(cleanPayload)) {
        try {
          const admin = getAdminClient()
          await syncLeadFromIntake(admin, { intakeId: recordId, fields: cleanPayload })
        } catch (e) {
          console.error('[intake POST] lead sync error:', e)
        }
      }
    }
  }

  // Spouse lives in contacts (single source of truth), not on client_intake.
  {
    const spouseFirst = typeof body.spouse_first_name === 'string' ? body.spouse_first_name.trim() : ''
    const spouseLast  = typeof body.spouse_last_name  === 'string' ? body.spouse_last_name.trim()  : ''
    if (spouseFirst || spouseLast) {
      try {
        const admin = getAdminClient()
        await saveHouseholdContact(admin, {
          householdId:        recordId,
          relationship_type:  'spouse',
          first_name:         spouseFirst,
          last_name:          spouseLast,
          middle_name:        typeof body.spouse_middle_name       === 'string' ? body.spouse_middle_name       : null,
          suffix:             typeof body.spouse_suffix            === 'string' ? body.spouse_suffix            : null,
          preferred_name:     typeof body.spouse_preferred_name    === 'string' ? body.spouse_preferred_name    : null,
          prior_names:        typeof body.spouse_prior_names       === 'string' ? body.spouse_prior_names       : null,
          preferred_pronoun:  typeof body.spouse_preferred_pronoun === 'string' ? body.spouse_preferred_pronoun : null,
          date_of_birth:      optionalDateOrNull(body.spouse_date_of_birth),
          is_us_citizen:      typeof body.spouse_is_us_citizen === 'boolean' ? body.spouse_is_us_citizen : null,
          email:              typeof body.spouse_email === 'string' ? body.spouse_email : null,
          phone:              typeof body.spouse_phone === 'string' ? body.spouse_phone : null,
          source:             'client',
        })
      } catch (e) {
        console.error('[intake POST bearer] spouse contact save error:', e)
      }
    }
  }

  const children = intakeChildrenFromRequestBody(body)
  if (children) {
    try {
      const admin = getAdminClient()
      await reconcileHouseholdChildren(admin, recordId, children)
    } catch (e) {
      console.error('[intake POST bearer] children contact save error:', e)
    }
  }

  const additionalContacts = intakeAdditionalContactsFromRequestBody(body)
  if (additionalContacts) {
    try {
      const admin = getAdminClient()
      await saveAdditionalContacts(admin, recordId, additionalContacts)
    } catch (e) {
      console.error('[intake POST bearer] additional contacts save error:', e)
    }
  }

  // Same write-through to contacts + contact_roles as the token branch.
  try {
    const admin = getAdminClient()
    const fiduciaryRoles = fiduciaryEntriesToRoles(body.fiduciary_entries)
    if (fiduciaryRoles.length > 0 || fiduciaryEntriesTouchesManagedRoles(body.fiduciary_entries)) {
      await persistFiduciaryRoles(admin, recordId, fiduciaryRoles)
    }
  } catch (e) {
    console.error('[intake POST bearer] fiduciary roles persist error:', e)
  }

  // On submit:
  //   - mark the intake completed
  //   - if a matter already exists for this intake (post-conversion), advance
  //     its stage from 'intake' → 'drafting' and seed the design sheet
  //   - never auto-create a matter; that happens at lead-conversion time
  //   - notify the firm
  if (body.status === 'submitted') {
    let admin: ReturnType<typeof getAdminClient>
    try { admin = getAdminClient() } catch (e) {
      console.error('[intake POST] admin client unavailable (missing SUPABASE_SERVICE_ROLE_KEY):', e)
      return NextResponse.json({ id: recordId })
    }

    await admin
      .from('client_intake')
      .update({
        intake_completed_at: new Date().toISOString(),
        attorney_review_flags: reviewFlags,
      })
      .eq('id', recordId)

    const { data: existingMatter } = await admin
      .from('matters')
      .select('id, stage, relationship_status')
      .eq('client_intake_id', recordId)
      .maybeSingle()

    if (existingMatter?.relationship_status === 'hired') {
      if (existingMatter.stage === 'intake') {
        const { data: advanced } = await admin
          .from('matters')
          .update({
            stage: 'intake_review',
            intake_submitted_at: new Date().toISOString(),
            stage_entered_at: new Date().toISOString(),
          })
          .eq('id', existingMatter.id)
          .eq('stage', 'intake')
          .select('id')
          .maybeSingle()

        if (advanced) {
          await admin.from('matter_activity').insert({
            matter_id: existingMatter.id,
            event_type: 'intake_completed',
            title: 'Intake submitted',
            detail: 'Client submitted intake questionnaire',
          })
        }
      } else {
        await admin
          .from('matters')
          .update({ intake_submitted_at: new Date().toISOString() })
          .eq('id', existingMatter.id)
      }
    }

    await seedDesignSheetAndJobs(admin, {
      intakeId: recordId,
      matterId: existingMatter?.relationship_status === 'hired' ? (existingMatter.id as string) : null,
      reviewFlags,
    })

    const clientName = [body.first_name, body.last_name].filter(Boolean).join(' ') || 'Client'
    const clientEmail = body.email ?? user.email ?? ''
    void notifyIntakeComplete(clientName, clientEmail, existingMatter?.relationship_status === 'hired' ? existingMatter.id : null)
      .catch((err) => console.error('[intake POST bearer] notify error:', err))
    try {
      revalidateSidebarCounts()
    } catch (err) {
      console.error('[intake POST bearer] sidebar revalidate failed:', err)
    }
  }

  return NextResponse.json({ id: recordId })
}
