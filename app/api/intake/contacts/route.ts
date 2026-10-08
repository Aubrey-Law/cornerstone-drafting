import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveIntakeByInviteToken } from '@/lib/intake/standingLinks'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { AdditionalContactInputError, saveAdditionalContacts } from '@/lib/contacts/saveAdditionalContacts'
import { IntakeFiduciaryInputError, validateIntakeFiduciaryInput } from '@/lib/contacts/intakeFiduciaryInput'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { formatPhoneForStorage } from '@/lib/phone'
import { saveHouseholdContact } from '@/lib/contacts/saveHouseholdContact'
import { attachContactToMatter, matterIdForIntake } from '@/lib/contacts/attachContactToMatter'
import type { HouseholdRelationship } from '@/lib/contacts/saveHouseholdContact'
import { reconcileHouseholdChildren } from '@/lib/contacts/reconcileHouseholdChildren'
import {
  citizenshipStatusToLegacyBoolean,
  normalizeCitizenshipStatus,
} from '@/lib/sharedFields'

function contactKey(first: unknown, last: unknown) {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

function contactPayloadFromEntry(entry: Record<string, unknown>) {
  const line =
    composedAddressOneLine({
      street: entry.street,
      city: entry.city,
      state: entry.state,
      zip: entry.zip,
    }) ??
    (typeof entry.address === 'string' && entry.address.trim() ? entry.address.trim() : null)

  const city =
    typeof entry.city === 'string' ? (entry.city.trim() || null) : null
  const state =
    typeof entry.state === 'string' ? (entry.state.trim() || null) : null
  const zip =
    typeof entry.zip === 'string' ? (entry.zip.trim() || null) : null

  // Pronouns are also editable on the design sheet's contact editor, so an
  // entry that carries no pronoun leaves the stored one alone rather than
  // clearing it.
  const pronounRaw = entry.preferred_pronoun ?? entry.pronouns
  const pronoun = typeof pronounRaw === 'string' ? pronounRaw.trim() : ''

  return {
    middle_name:
      typeof entry.middle_name === 'string' ? entry.middle_name.trim() || null : null,
    ...(pronoun ? { preferred_pronoun: pronoun } : {}),
    phone: formatPhoneForStorage(typeof entry.phone === 'string' ? entry.phone : ''),
    email: (entry.email as string | undefined)?.trim() || null,
    address_line1: line,
    city,
    state,
    zip,
    relationship_label:
      typeof entry.relationship === 'string'
        ? entry.relationship.trim() || null
        : null,
  }
}

function makeUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )
}

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  const publicToken = req.headers.get('x-intake-token')
  if (!token && !publicToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let bearerUserId: string | undefined
  if (!publicToken) {
    const userClient = makeUserClient(token!)
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    bearerUserId = user.id
  }
  const admin = getAdminClient()
  const body = await req.json()
  const { action, intakeId } = body

  if (!intakeId) return NextResponse.json({ error: 'intakeId required' }, { status: 400 })

  if (publicToken) {
    // Public capability is restricted to its unregistered, editable household.
    // Never fall back to a bearer session when an invite fails validation.
    const intake = await resolveIntakeByInviteToken(admin, publicToken)
    if (!intake || intake.id !== intakeId || intake.user_id || intake.client_user_id) {
      return NextResponse.json({ error: 'Invalid or expired intake token' }, { status: 401 })
    }
    if (intake.status === 'submitted' || intake.status === 'approved') {
      return NextResponse.json({ error: 'Intake is locked. Contact your attorney to make changes.' }, { status: 409 })
    }
    if (!['save_spouse', 'save_children', 'save_additional_contacts', 'save_fiduciaries'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported public contact action' }, { status: 403 })
    }
  } else {
    // Verify the intake belongs to this user (either portal ownership column).
    const ownedOrClause = `user_id.eq.${bearerUserId},client_user_id.eq.${bearerUserId}`
    const { data: intake } = await admin
      .from('client_intake')
      .select('id')
      .eq('id', intakeId)
      .or(ownedOrClause)
      .maybeSingle()
    if (!intake) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    if (action === 'upsert_contact') {
      const {
        first_name,
        middle_name,
        last_name,
        email,
        phone,
        address,
        relationship,
        relationship_type,
        preferred_pronoun,
      } = body
      const normalized = normalizeContactRelationshipType(relationship_type ?? relationship)
      // For non-singletons, preserve the existing name-match lookup so an edit
      // updates the right row instead of inserting a duplicate.
      let contactId: string | null = null
      if (normalized !== 'spouse') {
        const { data: existing } = await admin
          .from('contacts')
          .select('id')
          .eq('client_intake_id', intakeId)
          .eq('first_name', first_name)
          .eq('last_name', last_name)
          .maybeSingle()
        contactId = (existing as { id?: string } | null)?.id ?? null
      }
      const { id } = await saveHouseholdContact(admin, {
        householdId: intakeId,
        relationship_type: normalized as HouseholdRelationship,
        contact_id: contactId,
        first_name,
        middle_name: middle_name ?? null,
        last_name,
        preferred_pronoun: typeof preferred_pronoun === 'string' ? preferred_pronoun : null,
        email: email ?? null,
        phone: typeof phone === 'string' ? phone : null,
        address_line1: address ?? null,
      })
      return NextResponse.json({ ok: true, id })
    }

    if (action === 'save_spouse') {
      const { data: spouseData } = body
      const citizenshipStatus = normalizeCitizenshipStatus(
        spouseData.citizenship_status,
        typeof spouseData.is_us_citizen === 'boolean' ? spouseData.is_us_citizen : null,
      )
      const { id } = await saveHouseholdContact(admin, {
        householdId: intakeId,
        relationship_type: 'spouse',
        first_name: spouseData.first_name ?? '',
        last_name: spouseData.last_name ?? '',
        middle_name: spouseData.middle_name ?? null,
        suffix: spouseData.suffix ?? null,
        prior_names: spouseData.prior_names ?? spouseData.prior_name ?? null,
        preferred_pronoun: spouseData.preferred_pronoun ?? spouseData.pronouns ?? null,
        date_of_birth: spouseData.date_of_birth ?? null,
        is_us_citizen: citizenshipStatusToLegacyBoolean(citizenshipStatus),
        citizenship_status: citizenshipStatus,
        email: spouseData.email ?? null,
        phone: typeof spouseData.phone === 'string' ? spouseData.phone : null,
        source: 'client',
      })
      return NextResponse.json({ ok: true, id })
    }

    if (action === 'save_children') {
      const { children } = body
      const incoming = (children ?? []) as Array<Record<string, unknown>>
      // Reconcile (match by contact_id/name, preserve attorney-set fields, then
      // delegate to the sole writer). Extracted to lib for isolated testing.
      await reconcileHouseholdChildren(admin, intakeId, incoming)
      return NextResponse.json({ ok: true })
    }

    if (action === 'save_fiduciaries') {
      const { role, forParty } = body
      const validEntries = validateIntakeFiduciaryInput(body)
      // Validate semantics and every scoped identity before the first mutation.
      const existingContacts = validEntries.length > 0
          ? admin
              .from('contacts')
              .select('id, first_name, last_name')
              .eq('client_intake_id', intakeId)
          : Promise.resolve({ data: [] as Array<{ id: string; first_name: string; last_name: string }>, error: null })
      const contactsResult = await existingContacts
      if (contactsResult.error) throw new Error(contactsResult.error.message)

      const contactRows =
        (contactsResult.data ?? []) as Array<{ id: string; first_name: string; last_name: string }>

      const byName = new Map<string, string>()
      const intakeContactIds = new Set<string>()
      for (const c of contactRows) {
        byName.set(contactKey(c.first_name, c.last_name), c.id)
        intakeContactIds.add(c.id)
      }
      for (const entry of validEntries) {
        if (entry.contact_id && !intakeContactIds.has(entry.contact_id as string)) throw new IntakeFiduciaryInputError('Fiduciary contact does not belong to this intake')
      }
      const { error: deleteError } = await admin.from('contact_roles').delete()
        .eq('client_intake_id', intakeId).eq('role', role).eq('for_party', forParty)
      if (deleteError) throw new Error(deleteError.message)

      const updates: Array<Promise<unknown>> = []
      const inserts: Array<{ entry: Record<string, unknown>; payload: Record<string, unknown> }> = []

      for (const entry of validEntries) {
        const cid =
          typeof entry.contact_id === 'string' && /^[\da-f-]{36}$/i.test(entry.contact_id.trim())
            ? entry.contact_id.trim()
            : null

        const existingId =
          cid && intakeContactIds.has(cid) ? cid : byName.get(contactKey(entry.first_name, entry.last_name))

        const patchFields = contactPayloadFromEntry(entry)

        if (existingId) {
          updates.push(
            (async () => {
              const { error } = await admin.from('contacts').update(patchFields).eq('id', existingId)
              if (error) throw error
            })()
          )
        } else {
          const relationshipRaw =
            typeof entry.relationship === 'string' ? entry.relationship : undefined
          inserts.push({
            entry,
            payload: {
              client_intake_id: intakeId,
              relationship_type: normalizeContactRelationshipType(relationshipRaw),
              first_name: entry.first_name ?? '',
              last_name: entry.last_name ?? '',
              ...patchFields,
            },
          })
        }
      }

      // Run updates in parallel; do all inserts as a single batch and
      // recover the new ids in name order from the returned rows.
      const insertPromise = inserts.length > 0
        ? admin.from('contacts').insert(inserts.map(i => i.payload)).select('id, first_name, last_name')
        : Promise.resolve({ data: [] as Array<{ id: string; first_name: string; last_name: string }>, error: null })

      const [, insertResult] = await Promise.all([Promise.all(updates), insertPromise])
      if ((insertResult as { error?: unknown }).error) throw (insertResult as { error: unknown }).error

      // Step 7a: every newly created person joins the matter directly, rather
      // than relying on sync_matter_contacts_from_contact to infer it from the
      // household FK — that trigger goes with the column in 7b.
      const portalMatterId = await matterIdForIntake(admin, intakeId)
      for (const row of (insertResult as { data: Array<{ id: string }> }).data ?? []) {
        await attachContactToMatter(admin, portalMatterId, row.id, { relationship_type: 'other' })
      }

      const insertedById = new Map<string, string>()
      for (const row of (insertResult as { data: Array<{ id: string; first_name: string; last_name: string }> }).data ??
        []) {
        const k = contactKey(row.first_name, row.last_name)
        insertedById.set(k, row.id)
        byName.set(k, row.id)
        intakeContactIds.add(row.id)
      }

      const roleRows = validEntries.map(entry => {
        const cid =
          typeof entry.contact_id === 'string' && /^[\da-f-]{36}$/i.test(entry.contact_id.trim())
            ? entry.contact_id.trim()
            : null

        let contactId =
          cid && intakeContactIds.has(cid) ? cid : byName.get(contactKey(entry.first_name, entry.last_name))

        contactId ||= insertedById.get(contactKey(entry.first_name, entry.last_name))

        if (!contactId) return null

        return {
          client_intake_id: intakeId,
          contact_id: contactId,
          role,
          for_party: forParty,
          priority: entry.priority,
          is_coagent: entry.is_coagent ?? false,
        }
      }).filter(Boolean)

      if (roleRows.length > 0) {
        const { error } = await admin.from('contact_roles').insert(roleRows as Array<Record<string, unknown>>)
        if (error) throw error
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'save_additional_contacts') {
      await saveAdditionalContacts(admin, intakeId, body.contacts ?? [])
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    if (err instanceof AdditionalContactInputError || err instanceof IntakeFiduciaryInputError) return NextResponse.json({ error: err.message }, { status: 400 })
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[intake/contacts] ${action} error:`, err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
