'use server'

import { revalidatePath } from 'next/cache'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdminServerAction } from '@/lib/serverActionAuth'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'
import { loadMatterContacts } from '@/lib/contacts/loadMatterContacts'

async function assertDraftingEligible(matterId: string) {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matters')
    .select('id')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Drafting is available only for hired matters')
  return admin
}

export async function saveLiDesignSheet(matterId: string, data: Record<string, unknown>) {
  await requireAdminServerAction()
  const admin = await assertDraftingEligible(matterId)
  const { error } = await admin
    .from('matters')
    .update({ li_design_sheet_data: data, updated_at: new Date().toISOString() })
    .eq('id', matterId)

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/drafting/${matterId}`)
  revalidatePath(`/admin/drafting/${matterId}?step=design`)
}


export async function updatePlanCoverage(matterId: string, coverage: 'no_trust' | 'trust_included') {
  await requireAdminServerAction()
  const admin = await assertDraftingEligible(matterId)
  const { error } = await admin
    .from('matters')
    .update({ li_plan_coverage: coverage, updated_at: new Date().toISOString() })
    .eq('id', matterId)

  if (error) throw new Error(error.message)
  revalidatePath(`/admin/drafting/${matterId}`)
  revalidatePath(`/admin/drafting/${matterId}?step=design`)
}

export async function addContact(data: {
  matterId: string
  first_name: string
  last_name: string
  relationship?: string
  phone?: string
  email?: string
  address?: string
}) {
  await requireAdminServerAction()
  const admin = await assertDraftingEligible(data.matterId)
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', data.matterId)
    .maybeSingle()

  if (matterError) throw new Error(matterError.message)
  if (!matter?.client_intake_id) throw new Error('This matter is missing a client intake record.')

  const { data: contact, error } = await admin
    .from('contacts')
    .insert({
      client_intake_id: matter.client_intake_id,
      first_name: data.first_name,
      last_name: data.last_name,
      relationship_type: normalizeContactRelationshipType(data.relationship),
      relationship_label: data.relationship ?? null,
      phone: formatPhoneForStorage(data.phone),
      email: data.email ?? null,
      address_line1: data.address ?? null,
    })
    .select('id, first_name, last_name, relationship_type, relationship_label, phone, email, address_line1')
    .single()

  if (error) throw new Error(error.message)

  // Map DB column names back to app-facing names
  return {
    id: contact.id,
    first_name: contact.first_name,
    last_name: contact.last_name,
    relationship: contact.relationship_label ?? contact.relationship_type,
    phone: formatPhoneDisplay(contact.phone),
    email: contact.email,
    address: contact.address_line1,
  }
}

export async function searchContacts(matterId: string, query: string) {
  await requireAdminServerAction()
  const admin = await assertDraftingEligible(matterId)
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (matterError) {
    console.error('searchContacts matter lookup error:', matterError)
    return []
  }

  if (!matter?.client_intake_id) return []

  // Read through the join (step 3 of docs/matter-contacts-migration.md), so
  // the fiduciary picker offers this matter's people.
  interface ContactOption {
    id: string
    first_name: string | null
    last_name: string | null
    relationship_type: string | null
    relationship_label: string | null
    phone: string | null
    email: string | null
    address_line1: string | null
  }

  let data: ContactOption[]
  try {
    data = (await loadMatterContacts(
      admin,
      matterId,
      'id, first_name, last_name, relationship_type, relationship_label, phone, email, address_line1',
    )) as unknown as ContactOption[]
  } catch (error) {
    console.error('searchContacts error:', error)
    return []
  }

  const normalized = query.trim().toLowerCase()
  return (data ?? [])
    .filter(contact => {
      if (!normalized) return true
      const first = contact.first_name?.toLowerCase() ?? ''
      const last = contact.last_name?.toLowerCase() ?? ''
      return first.includes(normalized) || last.includes(normalized)
    })
    .map(contact => ({
      id: contact.id,
      first_name: contact.first_name,
      last_name: contact.last_name,
      relationship: contact.relationship_label ?? contact.relationship_type,
      phone: formatPhoneDisplay(contact.phone),
      email: contact.email,
      address: contact.address_line1,
    }))
    .slice(0, 5)
}
