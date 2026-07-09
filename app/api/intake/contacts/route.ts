import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { formatPhoneForStorage } from '@/lib/phone'
import { saveHouseholdContact } from '@/lib/contacts/saveHouseholdContact'
import type { HouseholdRelationship } from '@/lib/contacts/saveHouseholdContact'
import { reconcileHouseholdChildren } from '@/lib/contacts/reconcileHouseholdChildren'
import { getBearerToken } from '@/lib/apiAuth'

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

  const city = typeof entry.city === 'string' ? entry.city.trim() || null : null
  const state = typeof entry.state === 'string' ? entry.state.trim() || null : null
  const zip = typeof entry.zip === 'string' ? entry.zip.trim() || null : null

  return {
    middle_name:
      typeof entry.middle_name === 'string' ? entry.middle_name.trim() || null : null,
    phone: formatPhoneForStorage(typeof entry.phone === 'string' ? entry.phone : ''),
    email: (entry.email as string | undefined)?.trim() || null,
    address_line1: line,
    city,
    state,
    zip,
    relationship_label:
      typeof entry.relationship === 'string' ? entry.relationship.trim() || null : null,
  }
}

function makeUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

export async function POST(req: Request) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userClient = makeUserClient(token)
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const body = await req.json()
  const { action, intakeId } = body

  if (!intakeId) return NextResponse.json({ error: 'intakeId required' }, { status: 400 })

  const ownedOrClause = `user_id.eq.${user.id},client_user_id.eq.${user.id}`
  const { data: intake } = await admin
    .from('client_intake')
    .select('id')
    .eq('id', intakeId)
    .or(ownedOrClause)
    .maybeSingle()
  if (!intake) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    if (action === 'upsert_contact') {
      const { first_name, middle_name, last_name, email, phone, address, relationship, relationship_type } = body
      const normalized = normalizeContactRelationshipType(relationship_type ?? relationship)
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
        email: email ?? null,
        phone: typeof phone === 'string' ? phone : null,
        address_line1: address ?? null,
      })
      return NextResponse.json({ ok: true, id })
    }

    if (action === 'save_spouse') {
      const { data: spouseData } = body
      const { id } = await saveHouseholdContact(admin, {
        householdId: intakeId,
        relationship_type: 'spouse',
        first_name: spouseData.first_name ?? '',
        last_name: spouseData.last_name ?? '',
        middle_name: spouseData.middle_name ?? null,
        date_of_birth: spouseData.date_of_birth ?? null,
        email: spouseData.email ?? null,
        phone: typeof spouseData.phone === 'string' ? spouseData.phone : null,
        source: 'client',
      })
      return NextResponse.json({ ok: true, id })
    }

    if (action === 'save_children') {
      const { children } = body
      await reconcileHouseholdChildren(admin, intakeId, (children ?? []) as Array<Record<string, unknown>>)
      return NextResponse.json({ ok: true })
    }

    if (action === 'save_fiduciaries') {
      const { entries, role, forParty } = body

      const validEntries: Array<Record<string, unknown>> = (entries ?? []).filter(
        (e: Record<string, unknown>) => e.first_name || e.last_name,
      )

      const [, existingContacts] = await Promise.all([
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
          : Promise.resolve({ data: [] as Array<{ id: string; first_name: string; last_name: string }> }),
      ])

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
            })(),
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

      const insertPromise =
        inserts.length > 0
          ? admin.from('contacts').insert(inserts.map((i) => i.payload)).select('id, first_name, last_name')
          : Promise.resolve({
              data: [] as Array<{ id: string; first_name: string; last_name: string }>,
              error: null,
            })

      const [, insertResult] = await Promise.all([Promise.all(updates), insertPromise])
      if ((insertResult as { error?: unknown }).error) throw (insertResult as { error: unknown }).error

      const insertedById = new Map<string, string>()
      for (const row of (insertResult as { data: Array<{ id: string; first_name: string; last_name: string }> }).data ??
        []) {
        const k = contactKey(row.first_name, row.last_name)
        insertedById.set(k, row.id)
        byName.set(k, row.id)
        intakeContactIds.add(row.id)
      }

      const roleRows = validEntries
        .map((entry) => {
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
        })
        .filter(Boolean)

      if (roleRows.length > 0) {
        const { error } = await admin.from('contact_roles').insert(roleRows as Array<Record<string, unknown>>)
        if (error) throw error
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
