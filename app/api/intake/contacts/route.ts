import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveIntakeByInviteToken } from '@/lib/intake/standingLinks'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { CLIENT_INTAKE_ADDITIONAL_SOURCE } from '@/lib/intakeContactSource'
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
      const { entries, role, forParty } = body

      const validEntries: Array<Record<string, unknown>> = (entries ?? []).filter(
        (e: Record<string, unknown>) => e.first_name || e.last_name
      )

      // Wipe existing roles of this type. delete().eq() chains operate on
      // the matching rows directly — no need to pre-fetch the ids.
      const [deletedRoles, existingContacts] = await Promise.all([
        admin
          .from('contact_roles')
          .delete()
          .eq('client_intake_id', intakeId)
          .eq('role', role)
          .eq('for_party', forParty),
        validEntries.length > 0
          ? admin
              .from('contacts')
              .select('id, first_name, last_name')
              .eq('client_intake_id', intakeId)
          : Promise.resolve({ data: [] as Array<{ id: string; first_name: string; last_name: string }>, error: null }),
      ])
      if (deletedRoles.error) throw new Error(deletedRoles.error.message)
      if (existingContacts.error) throw new Error(existingContacts.error.message)

      const contactRows =
        (existingContacts.data ?? []) as Array<{ id: string; first_name: string; last_name: string }>

      const byName = new Map<string, string>()
      const intakeContactIds = new Set<string>()
      for (const c of contactRows) {
        byName.set(contactKey(c.first_name, c.last_name), c.id)
        intakeContactIds.add(c.id)
      }

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
      const { contacts: nominees } = body
      const { error: deleteError } = await admin
        .from('contacts')
        .delete()
        .eq('client_intake_id', intakeId)
        .eq('source', CLIENT_INTAKE_ADDITIONAL_SOURCE)
      if (deleteError) throw new Error(deleteError.message)

      const rows = (nominees ?? [])
        .filter(
          (c: Record<string, unknown>) =>
            String(c.first_name ?? '').trim() && String(c.last_name ?? '').trim(),
        )
        .map((c: Record<string, unknown>) => {
          const patch = contactPayloadFromEntry({
            middle_name: c.middle_name,
            street: c.street,
            city: c.city,
            state: c.state,
            zip: c.zip,
            relationship: c.relationship,
            phone: c.phone,
            email: c.email,
            address: c.address,
          })
          return {
            client_intake_id: intakeId,
            relationship_type: normalizeContactRelationshipType('other'),
            first_name: String(c.first_name).trim(),
            last_name: String(c.last_name).trim(),
            suffix:
              typeof c.suffix === 'string' && c.suffix.trim() ? c.suffix.trim() : null,
            ...patch,
            source: CLIENT_INTAKE_ADDITIONAL_SOURCE,
            created_by_client_at: new Date().toISOString(),
          }
        })

      if (rows.length > 0) {
        const { data: created, error } = await admin
          .from('contacts').insert(rows).select('id, relationship_type')
        if (error) throw error
        const additionalMatterId = await matterIdForIntake(admin, intakeId)
        for (const row of (created ?? []) as Array<{ id: string; relationship_type: string | null }>) {
          await attachContactToMatter(admin, additionalMatterId, row.id, {
            relationship_type: row.relationship_type ?? 'other',
          })
        }
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[intake/contacts] ${action} error:`, err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
