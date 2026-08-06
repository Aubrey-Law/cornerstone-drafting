'use server'

import { getAdminClient, ADMIN_EMAIL } from '@/lib/supabaseAdmin'
import { createServerSupabase } from '@/lib/supabaseServer'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { revalidatePath } from 'next/cache'
import type { AdminIntakeFormData } from '@/types/adminIntake'
import { formatPhoneForStorage } from '@/lib/phone'
import { syncLeadFromIntake } from '@/lib/syncLeadFromIntake'
import { seedDesignSheetAndJobs } from '@/lib/intakeSeed'
import { getIntakeReadinessFlags, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { IntakeRow } from '@/lib/intakeSections'
import {
  adminFiduciaryEntriesFromForm,
  probateDetailsFromForm,
} from '@/lib/adminIntakeFiduciaries'
import { saveHouseholdContact } from '@/lib/contacts/saveHouseholdContact'
import { saveHouseholdChildren } from '@/lib/contacts/saveHouseholdChildren'
import { persistFiduciaryRoles, type FiduciaryRoleEntry } from '@/lib/contacts/persistFiduciaryRoles'
import { getHousehold } from '@/lib/contacts/getHousehold'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { linkIntakeToMatter } from '@/lib/intake/linkIntakeToMatter'
import { resolveMatterIntakeIdForMatter } from '@/lib/intake/resolveMatterIntakeId'
import { MATTER_INTAKE_LINK_COLUMNS } from '@/lib/matters/matterIntakeLink'
import { markIntakeUploadsReviewed as persistIntakeUploadsReviewed, markPortalUploadsReviewed as persistPortalUploadsReviewed } from '@/lib/matter/unreviewedUploads'

/**
 * Recompute and persist the attorney review flags for an intake.
 *
 * The row must be hydrated first. Spouse, children, and fiduciaries live in
 * `contacts` — `client_intake.spouse_*` and `client_intake.fiduciary_entries`
 * were dropped — and the readiness rules read the hydrated `_spouse` / `_fid_*`
 * keys. Passing a raw row makes every contacts-backed flag fire regardless of
 * what the attorney actually entered.
 */
async function recomputeIntakeReviewFlags(
  admin: ReturnType<typeof getAdminClient>,
  intakeId: string,
): Promise<IntakeReadinessFlag[]> {
  const { data: intakeRow } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', intakeId)
    .maybeSingle()
  if (!intakeRow) return []

  let hydrated: Record<string, unknown>
  try {
    hydrated = await hydrateIntakeWithContacts(admin, intakeRow, intakeId)
  } catch (error) {
    console.error('[adminIntake] hydrate for review flags failed:', error)
    return []
  }

  const reviewFlags = getIntakeReadinessFlags(hydrated as IntakeRow)
  await admin
    .from('client_intake')
    .update({ attorney_review_flags: reviewFlags })
    .eq('id', intakeId)
  return reviewFlags
}

async function syncIntakeToDesignSheet(
  admin: ReturnType<typeof getAdminClient>,
  intakeId: string,
  matterId: string | null,
  reviewFlags: IntakeReadinessFlag[],
): Promise<void> {
  try {
    await seedDesignSheetAndJobs(admin, { intakeId, matterId, reviewFlags })
  } catch (error) {
    console.error('[adminIntake] design sheet sync failed:', error)
  }
}

/** Write the spouse from the admin intake form through saveHouseholdContact.
 *  Only called when a spouse first_name+last_name is present; skipped otherwise
 *  so we don't create an empty spouse contact row. */
async function persistAdminSpouse(
  admin: ReturnType<typeof getAdminClient>,
  intakeId: string,
  data: AdminIntakeFormData,
): Promise<void> {
  const first = data.spouse_first_name?.trim() ?? ''
  const last = data.spouse_last_name?.trim() ?? ''
  if (!first && !last) return

  await saveHouseholdContact(admin, {
    householdId: intakeId,
    relationship_type: 'spouse',
    first_name: first,
    last_name: last,
    middle_name: data.spouse_middle_name || null,
    date_of_birth: data.spouse_date_of_birth || null,
    phone: data.spouse_phone || null,
    email: data.spouse_email || null,
    source: 'attorney_intake',
  })
}

/** Write children from the admin intake form through saveHouseholdChildren.
 *  Maps AdminIntakeChild (structured first/middle/last + date_of_birth) to
 *  HouseholdChildInput. The admin form does not capture relationship/parentage/
 *  is_minor, so existing values are preserved ("fill, don't wipe"); new children
 *  default to 'biological'/null/undefined so is_minor derives from DOB. */
async function persistAdminChildren(
  admin: ReturnType<typeof getAdminClient>,
  intakeId: string,
  data: AdminIntakeFormData,
): Promise<void> {
  const household = await getHousehold(admin, intakeId)
  const existingByName = new Map(
    household.children.map((c) => [fiduciaryNameKey(c.first_name, c.last_name), c]),
  )
  await saveHouseholdChildren(admin, intakeId, (data.children ?? []).map((c) => {
    const existing = existingByName.get(fiduciaryNameKey(c.first_name, c.last_name))
    return {
      contact_id: existing?.contact_id ?? (c.id || null),
      first_name: c.first_name ?? '',
      middle_name: c.middle_name || null,
      last_name: c.last_name ?? '',
      dob: c.date_of_birth || null,
      // Admin form does not capture these — preserve whatever is already stored
      // (set via the design sheet / contacts editor); default only for new children.
      relationship: existing?.child_relationship ?? 'biological',
      parentage: existing?.parentage ?? null,
      is_minor: existing ? existing.is_minor : undefined,
    }
  }))
}

// Re-export types for convenience (server-safe — type-only exports are fine)
export type { AdminIntakeFormData, AdminIntakeChild } from '@/types/adminIntake'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CLIENT_LOCKED_INTAKE_STATUSES = new Set(['submitted', 'approved'])

/** Resolve a valid auth.users ID to use as user_id on a new intake record.
 *  Prefers the client's own user ID; falls back to the admin user's ID so the
 *  FK constraint client_intake_user_id_fkey is never violated. */
async function resolveUserId(clientUserId: string | null): Promise<string> {
  if (clientUserId) return clientUserId
  const admin = getAdminClient()
  // auth.users is not accessible via the query builder — use the Auth Admin API
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`Failed to list users: ${error.message}`)
  const adminUser = data.users.find(u => u.email === ADMIN_EMAIL)
  if (!adminUser) throw new Error('Admin user not found — cannot create intake record')
  return adminUser.id
}

function buildPayload(data: AdminIntakeFormData, status: string) {
  return {
    status,
    current_step: 9,
    first_name: data.first_name || null,
    middle_name: data.middle_name || null,
    last_name: data.last_name || null,
    suffix: data.suffix || null,
    full_name: [data.first_name, data.middle_name, data.last_name].filter(Boolean).join(' ') || null,
    date_of_birth: data.date_of_birth || null,
    is_us_citizen: data.is_us_citizen,
    phone: formatPhoneForStorage(data.phone),
    email: data.email || null,
    address_line1: data.address_line1 || null,
    address_line2: data.address_line2 || null,
    city: data.city || null,
    state: data.state || null,
    zip: data.zip || null,
    county: data.county || null,
    marital_status: data.marital_status || null,
    has_children: data.has_children,
    has_minor_children: data.has_minor_children,
    // children rows are intentionally omitted here — they are written by
    // persistAdminChildren() via saveHouseholdChildren so the contacts rows and
    // the column mirror stay in sync through the single authoritative writer.
    // spouse_* columns are intentionally omitted here — they are written by
    // persistAdminSpouse() via saveHouseholdContact so the contacts row and the
    // column mirror stay in sync through the single authoritative writer.
    date_of_marriage: data.date_of_marriage || null,
    estate_value: data.estate_value || null,
    has_real_property: data.has_real_property,
    has_retirement: data.has_retirement,
    has_investments: data.has_investments,
    has_business: data.has_business,
    has_life_insurance: data.has_life_insurance,
    planning_objectives: data.planning_objectives || null,
    special_notes: data.special_notes || null,
    family_details: data.family_notes ? { notes: data.family_notes } : null,
    probate_details: probateDetailsFromForm(data),
    financial_details: {
      real_property_address: data.real_property_address || null,
      real_property_value: data.real_property_value || null,
      retirement_value: data.retirement_value || null,
      life_insurance_value: data.life_insurance_value || null,
      business_description: data.business_description || null,
    },
  }
}

function fiduciaryNameKey(first: unknown, last: unknown): string {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

/** Persist the admin sheet's flat fiduciary fields into the shared
 *  contacts / contact_roles model that drafting reads. Delegates to the
 *  shared writer (persistFiduciaryRoles) — same wipe + reuse-or-create +
 *  insert pattern, plus the JSONB projection so client wizard reads stay
 *  in sync. */
async function persistAdminFiduciaries(
  admin: ReturnType<typeof getAdminClient>,
  intakeId: string,
  data: AdminIntakeFormData,
): Promise<void> {
  const adminEntries = adminFiduciaryEntriesFromForm(data)
  const entries: FiduciaryRoleEntry[] = adminEntries.map((e) => ({
    role: e.role as FiduciaryRoleEntry['role'],
    for_party: e.for_party,
    priority: e.priority,
    is_coagent: false,
    first_name: e.first_name,
    last_name: e.last_name,
  }))
  await persistFiduciaryRoles(admin, intakeId, entries)
}

// ── Fetch existing intake data (for pre-population) ───────────────────────────

export async function getAdminIntakeData(
  clientIntakeId: string
): Promise<Record<string, unknown> | null> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', clientIntakeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return data

  // Attach fiduciary roles (joined to contacts) so the sheet can reconstruct
  // its flat trustee/executor/POA/HCP/guardian fields. These live in
  // contact_roles, not on client_intake.
  //
  // Also attach all contacts for the intake as _intake_contacts — the F3
  // picklist UI sources its suggestions from this list. Includes
  // lead-detail-imported contacts that don't yet have a contact_roles entry.
  const [{ data: roleRows }, { data: contactRows }] = await Promise.all([
    admin
      .from('contact_roles')
      .select('role, for_party, priority, is_coagent, contacts(first_name, last_name)')
      .eq('client_intake_id', clientIntakeId)
      .eq('for_party', 'client'),
    admin
      .from('contacts')
      .select('id, first_name, last_name, relationship_label')
      .eq('client_intake_id', clientIntakeId)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true }),
  ])

  const fiduciaryRoles = ((roleRows ?? []) as Array<Record<string, unknown>>).map((r) => {
    const contact = (r.contacts ?? null) as { first_name?: string | null; last_name?: string | null } | null
    return {
      role: r.role,
      for_party: r.for_party,
      priority: r.priority,
      is_coagent: r.is_coagent,
      first_name: contact?.first_name ?? null,
      last_name: contact?.last_name ?? null,
    }
  })

  const intakeContacts = ((contactRows ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    relationship_label: string | null
  }>).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    relationship_label: c.relationship_label,
  }))

  return hydrateIntakeWithContacts(admin, {
    ...data,
    _fiduciary_roles: fiduciaryRoles,
    _intake_contacts: intakeContacts,
  }, clientIntakeId)
}

/** Resolve and heal the household intake linked to a matter. */
export async function resolveMatterIntake(matterId: string): Promise<string | null> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  return resolveMatterIntakeIdForMatter(admin, matterId)
}

// ── Save draft ────────────────────────────────────────────────────────────────

interface AdminIntakeArgs {
  leadId?: string | null
  matterId?: string | null
  clientIntakeId: string | null
  clientUserId: string | null
  data: AdminIntakeFormData
}

async function findOrCreateIntake(
  args: AdminIntakeArgs,
  initialPayload: Record<string, unknown>,
): Promise<string> {
  const admin = getAdminClient()

  if (args.clientIntakeId) {
    await linkIntakeToMatter(admin, args.matterId, args.clientIntakeId)
    return args.clientIntakeId
  }

  // Matter-first: converted matters pass both leadId and matterId; the lead
  // branch alone never wrote client_intake_id back onto the matter row.
  if (args.matterId) {
    const { data: matter, error: matterError } = await admin
      .from('matters')
      .select(MATTER_INTAKE_LINK_COLUMNS)
      .eq('id', args.matterId)
      .maybeSingle()
    if (matterError) throw new Error(matterError.message)
    if (!matter) throw new Error('Matter not found')

    if (matter.client_intake_id) {
      const intakeId = matter.client_intake_id as string
      await linkIntakeToMatter(admin, args.matterId, intakeId)
      return intakeId
    }

    const userId = await resolveUserId((matter.client_id as string | null | undefined) ?? args.clientUserId)
    const { data: newRecord, error: insertError } = await admin
      .from('client_intake')
      .insert({
        ...initialPayload,
        user_id: userId,
      })
      .select('id')
      .single()
    if (insertError) throw new Error(insertError.message)

    const intakeId = newRecord.id as string
    await linkIntakeToMatter(admin, args.matterId, intakeId)
    return intakeId
  }

  if (!args.leadId) throw new Error('Lead or matter is required')

  const { data: existing } = await admin
    .from('client_intake')
    .select('id')
    .eq('lead_id', args.leadId)
    .maybeSingle()
  if (existing?.id) return existing.id as string

  const userId = await resolveUserId(args.clientUserId)
  const { data: newRecord, error: insertError } = await admin
    .from('client_intake')
    .insert({ ...initialPayload, user_id: userId, lead_id: args.leadId })
    .select('id')
    .single()
  if (insertError) throw new Error(insertError.message)
  return newRecord.id as string
}

export async function saveAdminIntakeDraft(args: AdminIntakeArgs): Promise<{ id: string }> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const draftPayload = buildPayload(args.data, 'draft')
  const intakeId = await findOrCreateIntake(args, draftPayload)

  const { data: currentIntake, error: currentIntakeError } = await admin
    .from('client_intake')
    .select('status')
    .eq('id', intakeId)
    .maybeSingle()
  if (currentIntakeError) throw new Error(currentIntakeError.message)

  const currentStatus = typeof currentIntake?.status === 'string' ? currentIntake.status : null
  const saveStatus = currentStatus && CLIENT_LOCKED_INTAKE_STATUSES.has(currentStatus)
    ? currentStatus
    : 'draft'
  const payload: Record<string, unknown> = buildPayload(args.data, saveStatus)

  const { error } = await admin.from('client_intake').update(payload).eq('id', intakeId)
  if (error) throw new Error(error.message)

  await persistAdminFiduciaries(admin, intakeId, args.data)
  await persistAdminSpouse(admin, intakeId, args.data)
  await persistAdminChildren(admin, intakeId, args.data)

  await syncLeadFromIntake(admin, { intakeId, fields: payload })

  let reviewFlags: IntakeReadinessFlag[] = []
  if (CLIENT_LOCKED_INTAKE_STATUSES.has(saveStatus)) {
    reviewFlags = await recomputeIntakeReviewFlags(admin, intakeId)
  }

  // Push attorney edits into the design sheet so the drafting workspace
  // reflects them even on subsequent visits. Submitted/approved intakes stay
  // locked to clients and keep their attorney review flags current.
  let matterIdForSync = args.matterId ?? null
  if (!matterIdForSync) {
    const { data: matter } = await admin
      .from('matters')
      .select('id')
      .eq('client_intake_id', intakeId)
      .maybeSingle()
    matterIdForSync = (matter?.id as string | undefined) ?? null
  }
  if (args.matterId) {
    await linkIntakeToMatter(admin, args.matterId, intakeId)
    matterIdForSync = args.matterId
  }

  await syncIntakeToDesignSheet(admin, intakeId, matterIdForSync, reviewFlags)

  if (args.leadId) revalidatePath(`/admin/crm/opportunities/${args.leadId}`)
  if (args.matterId) revalidatePath(`/admin/matters/${args.matterId}`)
  return { id: intakeId }
}

// ── Submit intake ─────────────────────────────────────────────────────────────

const NOTE_MARKER = '__intake_data__'

function buildExtendedDataNote(data: AdminIntakeFormData) {
  return {
    _kind: NOTE_MARKER,
    goals: {
      primaryGoals: [],
      specialConsiderations: data.special_circumstances.join(', '),
      wishesAndConcerns: data.planning_objectives,
    },
    importantInfo: {
      hasWill: data.has_will,
      hasTrust: data.has_trust,
      hasPOA: data.has_poa,
      hasHealthcareProxy: data.has_hcp,
      existingDocNotes: '',
      specialCircumstances: data.special_circumstances.join(', '),
    },
  }
}

/** Submit the intake. Marks the intake submitted; if (and only if) a matter
 *  already exists for this intake (post-conversion), advance it to drafting
 *  and seed the design sheet + extended-data note. Pre-conversion submits
 *  leave the matter table untouched — the matter is created at convert time. */
export async function submitAdminIntake(args: AdminIntakeArgs): Promise<{ id: string }> {
  await requireAdminServerAction()
  const admin = getAdminClient()
  const payload = buildPayload(args.data, 'submitted')
  const intakeId = await findOrCreateIntake(args, payload)

  const { error } = await admin
    .from('client_intake')
    .update({ ...payload, intake_completed_at: new Date().toISOString() })
    .eq('id', intakeId)
  if (error) throw new Error(error.message)

  await persistAdminFiduciaries(admin, intakeId, args.data)
  await persistAdminSpouse(admin, intakeId, args.data)
  await persistAdminChildren(admin, intakeId, args.data)

  await syncLeadFromIntake(admin, { intakeId, fields: payload })

  // If a matter already exists (lead was already converted), advance it.
  const { data: matter } = await admin
    .from('matters')
    .select('id, stage, relationship_status')
    .eq('client_intake_id', intakeId)
    .maybeSingle()

  // Compute readiness flags from the just-written intake row so the design
  // sheet seed and matter_alerts surface the same information the client-
  // portal submit path produces.
  const reviewFlags = await recomputeIntakeReviewFlags(admin, intakeId)

  const hiredMatterId = matter?.relationship_status === 'hired' ? (matter.id as string) : null
  await syncIntakeToDesignSheet(admin, intakeId, hiredMatterId, reviewFlags)

  if (matter?.relationship_status === 'hired') {
    const matterUpdate: Record<string, unknown> = {
      intake_submitted_at: new Date().toISOString(),
    }
    if (matter.stage === 'intake') matterUpdate.stage = 'drafting'
    await admin.from('matters').update(matterUpdate).eq('id', matter.id)

    if (matter.stage === 'intake') {
      // Refresh extended-data note (safe to re-run; uses delete-then-insert).
      await admin.from('matter_notes')
        .delete()
        .eq('matter_id', matter.id)
        .eq('note_type', 'internal')
        .like('body', `%"${NOTE_MARKER}"%`)
      await admin.from('matter_notes').insert({
        matter_id: matter.id,
        note_type: 'internal',
        body: JSON.stringify(buildExtendedDataNote(args.data)),
      })

      await admin.from('matter_activity').insert({
        matter_id: matter.id,
        event_type: 'stage_changed',
        title: 'Intake submitted',
        detail: 'Intake submitted via admin Fill Intake',
        metadata: { from_stage: 'intake', to_stage: 'drafting' },
      })
    }

    revalidatePath(`/admin/matters/${matter.id}`)
    revalidatePath('/admin/matters')
    revalidatePath('/admin/dashboard')
  }

  if (args.leadId) revalidatePath(`/admin/crm/opportunities/${args.leadId}`)
  if (args.matterId) {
    await linkIntakeToMatter(admin, args.matterId, intakeId)
    revalidatePath(`/admin/matters/${args.matterId}`)
  }
  revalidatePath('/admin/pipeline')
  return { id: intakeId }
}

// ── Unlock submitted intake ───────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['attorney', 'admin'])

interface UnlockIntakeArgs {
  intakeId: string
  matterId?: string | null
}

/** Re-open a submitted intake for client editing. Attorney/admin only. */
export async function unlockIntake(args: UnlockIntakeArgs): Promise<void> {
  const sb = await createServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: caller } = await sb
    .from('users')
    .select('role, display_name, email')
    .eq('id', user.id)
    .maybeSingle()
  if (!caller || !ADMIN_ROLES.has(caller.role as string)) {
    throw new Error('Forbidden')
  }

  const admin = getAdminClient()

  const { data: intake, error: intakeError } = await admin
    .from('client_intake')
    .select('id')
    .eq('id', args.intakeId)
    .maybeSingle()
  if (intakeError) throw new Error(intakeError.message)
  if (!intake) throw new Error('Intake not found')

  let resolvedMatterId = args.matterId ?? null
  if (!resolvedMatterId) {
    const { data: matter } = await admin
      .from('matters')
      .select('id')
      .eq('client_intake_id', args.intakeId)
      .maybeSingle()
    resolvedMatterId = (matter?.id as string | undefined) ?? null
  }

  const { error: updateError } = await admin
    .from('client_intake')
    .update({
      status: 'draft',
      intake_completed_at: null,
      unlock_requested_at: null,
      unlock_request_note: null,
    })
    .eq('id', args.intakeId)
  if (updateError) throw new Error(updateError.message)

  if (resolvedMatterId) {
    const { error: activityError } = await admin.from('matter_activity').insert({
      matter_id: resolvedMatterId,
      event_type: 'status_changed',
      actor_id: user.id,
      actor_email: caller.email ?? user.email ?? null,
      actor_name: (caller.display_name as string | null) ?? null,
      title: 'Intake unlocked',
      detail: 'Re-opened the submitted intake for client editing.',
      metadata: { kind: 'intake_unlocked', client_intake_id: args.intakeId },
    })
    if (activityError) {
      console.warn('[unlockIntake] matter_activity skipped:', activityError.message)
    }
    revalidatePath(`/admin/matters/${resolvedMatterId}`)
  }

  revalidatePath('/intake')
}

interface MarkUploadsReviewedArgs {
  intakeId: string
  matterId: string
}

/** Mark intake questionnaire uploads as reviewed by staff (attorney/admin only). */
export async function markIntakeUploadsReviewed(args: MarkUploadsReviewedArgs): Promise<void> {
  const sb = await createServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: caller } = await sb
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!caller || !ADMIN_ROLES.has(caller.role as string)) {
    throw new Error('Forbidden')
  }

  const admin = getAdminClient()
  const { data: intake, error: intakeError } = await admin
    .from('client_intake')
    .select('id')
    .eq('id', args.intakeId)
    .maybeSingle()
  if (intakeError) throw new Error(intakeError.message)
  if (!intake) throw new Error('Intake not found')

  await persistIntakeUploadsReviewed(admin, args.intakeId)
  revalidatePath(`/admin/matters/${args.matterId}`)
  revalidatePath('/admin/matters')
}

interface MarkPortalUploadsReviewedArgs {
  matterId: string
}

/** Mark client portal uploads as reviewed by staff (attorney/admin only). */
export async function markPortalUploadsReviewed(args: MarkPortalUploadsReviewedArgs): Promise<void> {
  const sb = await createServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: caller } = await sb
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!caller || !ADMIN_ROLES.has(caller.role as string)) {
    throw new Error('Forbidden')
  }

  const admin = getAdminClient()
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id')
    .eq('id', args.matterId)
    .maybeSingle()
  if (matterError) throw new Error(matterError.message)
  if (!matter) throw new Error('Matter not found')

  await persistPortalUploadsReviewed(admin, args.matterId)
  revalidatePath(`/admin/matters/${args.matterId}`)
  revalidatePath('/admin/matters')
}
