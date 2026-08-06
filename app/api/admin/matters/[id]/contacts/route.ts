import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import {
  ADMIN_FIDUCIARY_CONTACT_SOURCE,
  insertFiduciaryContactsForIntake,
  sanitizeLeadFiduciaryContacts,
} from '@/lib/leadFiduciaries'
import { saveHouseholdContact } from '@/lib/contacts/saveHouseholdContact'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'

const ROLE_LABELS: Record<string, string> = {
  trustee: 'Trustee',
  personal_rep: 'Personal Representative',
  executor: 'Personal Representative',
  poa: 'Power of Attorney',
  hcp: 'Health Care Proxy',
  guardian: 'Guardian',
}

const CLIENT_FIELDS = new Set([
  'first_name', 'middle_name', 'last_name', 'email', 'phone',
  'address_line1', 'city', 'state', 'zip',
  'suffix', 'preferred_name', 'preferred_pronoun', 'date_of_birth',
  // Edited inline from the matter facts panel's identity header and Contact section.
  'full_name', 'marital_status', 'has_minor_children',
])

const CONTACT_FIELDS = new Set([
  'first_name', 'middle_name', 'last_name', 'email', 'phone',
  'address_line1', 'date_of_birth', 'relationship_label',
  'suffix', 'preferred_name', 'preferred_pronoun',
])

type Params = { params: Promise<{ id: string }> }

interface ContactRoleRow {
  role: string
  for_party: string
  priority: number | null
  is_coagent: boolean | null
}

interface ContactRow {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  date_of_birth: string | null
  relationship_type: string | null
  relationship_label: string | null
  contact_roles: ContactRoleRow[] | null
}

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()

  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (!matter?.client_intake_id) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const intakeId = matter.client_intake_id as string

  const [intakeRes, contactsRes] = await Promise.all([
    admin
      .from('client_intake')
      .select('id, first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, date_of_birth, email, phone, address_line1, city, state, zip, full_name, marital_status, has_minor_children')
      .eq('id', intakeId)
      .single(),
    admin
      .from('contacts')
      .select(`
        id, first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, email, phone, address_line1, date_of_birth,
        relationship_type, relationship_label,
        contact_roles ( role, for_party, priority, is_coagent )
      `)
      .eq('client_intake_id', intakeId)
      .order('created_at', { ascending: true })
      .returns<ContactRow[]>(),
  ])

  if (intakeRes.error || !intakeRes.data) {
    return NextResponse.json({ error: 'Intake not found' }, { status: 404 })
  }

  const contacts = (contactsRes.data ?? []).map(c => ({
    ...c,
    phone: formatPhoneDisplay(c.phone),
    role_labels: (c.contact_roles ?? []).map(r => {
      const label = ROLE_LABELS[r.role] ?? r.role
      const party = r.for_party === 'spouse' ? ' (spouse)' : ''
      const seat = r.priority === 1 ? '' : ` alt ${(r.priority ?? 1) - 1}`
      const coagent = r.is_coagent ? ' co-agent' : ''
      return `${label}${party}${seat}${coagent}`.trim()
    }),
  }))

  return NextResponse.json({
    client: {
      ...intakeRes.data,
      phone: formatPhoneDisplay(intakeRes.data.phone),
    },
    contacts,
  })
}

type HouseholdPostBody = {
  relationship_type: 'spouse' | 'child'
  first_name: string
  last_name: string
  middle_name?: string | null
  suffix?: string | null
  preferred_name?: string | null
  preferred_pronoun?: string | null
  date_of_birth?: string | null
  email?: string | null
  phone?: string | null
  address_line1?: string | null
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()
  const body = await req.json().catch(() => null) as { contacts?: unknown; household?: HouseholdPostBody } | null

  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (!matter?.client_intake_id) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const intakeId = matter.client_intake_id as string

  if (body?.household) {
    const h = body.household
    if (h.relationship_type !== 'spouse' && h.relationship_type !== 'child') {
      return NextResponse.json({ error: 'relationship_type must be spouse or child' }, { status: 400 })
    }
    const first = h.first_name?.trim() ?? ''
    const last = h.last_name?.trim() ?? ''
    if (!first && !last) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    try {
      const { id } = await saveHouseholdContact(admin, {
        householdId: intakeId,
        relationship_type: h.relationship_type,
        first_name: first,
        last_name: last,
        middle_name: h.middle_name ?? null,
        suffix: h.suffix ?? null,
        preferred_name: h.preferred_name ?? null,
        preferred_pronoun: h.preferred_pronoun ?? null,
        date_of_birth: h.date_of_birth ?? null,
        email: h.email ?? null,
        phone: h.phone ?? null,
        address_line1: h.address_line1 ?? null,
        source: 'attorney_intake',
      })
      return NextResponse.json({ ok: true, contactId: id })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save household member'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  const { contacts, error: sanitizeError } = sanitizeLeadFiduciaryContacts(body?.contacts)
  if (sanitizeError) return NextResponse.json({ error: sanitizeError }, { status: 400 })
  if (contacts.length === 0) return NextResponse.json({ error: 'At least one contact is required' }, { status: 400 })

  const result = await insertFiduciaryContactsForIntake(admin, {
    clientIntakeId: intakeId,
    contacts,
    source: ADMIN_FIDUCIARY_CONTACT_SOURCE,
  })

  return NextResponse.json({ ok: true, insertedContactCount: result.insertedContactCount })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()

  const body = await req.json().catch(() => null) as
    | { target: 'client'; patch: Record<string, unknown> }
    | { target: 'contact'; contactId: string; patch: Record<string, unknown> }
    | null

  if (!body || !body.target || !body.patch) {
    return NextResponse.json({ error: 'target and patch required' }, { status: 400 })
  }

  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  if (!matter?.client_intake_id) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const intakeId = matter.client_intake_id as string

  if (body.target === 'client') {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body.patch)) {
      if (CLIENT_FIELDS.has(k)) patch[k] = k === 'phone' ? formatPhoneForStorage(typeof v === 'string' ? v : '') : v === '' ? null : v
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true })
    }
    const { error } = await admin.from('client_intake').update(patch).eq('id', intakeId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.target === 'contact') {
    if (!body.contactId) {
      return NextResponse.json({ error: 'contactId required' }, { status: 400 })
    }
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body.patch)) {
      if (CONTACT_FIELDS.has(k)) patch[k] = k === 'phone' ? formatPhoneForStorage(typeof v === 'string' ? v : '') : v === '' ? null : v
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true })
    }
    // Scope the update to this matter's intake to prevent cross-matter writes.
    const { error } = await admin
      .from('contacts')
      .update(patch)
      .eq('id', body.contactId)
      .eq('client_intake_id', intakeId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown target' }, { status: 400 })
}

// DELETE /api/admin/matters/[id]/contacts?contactId=...  →  remove a contact
// from this matter's intake. The spouse is auto-managed from the intake spouse
// fields and the primary client is the intake itself, so neither can be deleted
// here.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const contactId = new URL(req.url).searchParams.get('contactId')
  if (!contactId) return NextResponse.json({ error: 'contactId is required' }, { status: 400 })

  const admin = getAdminClient()

  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()
  if (!matter?.client_intake_id) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const intakeId = matter.client_intake_id as string

  const { data: contact, error: loadError } = await admin
    .from('contacts')
    .select('id, relationship_type')
    .eq('id', contactId)
    .eq('client_intake_id', intakeId)
    .maybeSingle()
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  if (contact.relationship_type === 'spouse') {
    return NextResponse.json(
      { error: 'The spouse is managed from the intake — edit the spouse fields to change or remove it.' },
      { status: 409 },
    )
  }

  // Clear fiduciary role assignments and delete the contact atomically (scoped
  // to this matter's intake) so a failed delete can't strand orphaned data.
  const { data: deletedCount, error } = await admin.rpc('delete_intake_contact', {
    p_contact_id: contactId,
    p_client_intake_id: intakeId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!deletedCount) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
