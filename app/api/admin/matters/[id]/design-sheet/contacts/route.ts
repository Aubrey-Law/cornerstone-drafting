import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { syncChildrenProjection } from '@/lib/contacts/syncChildrenProjection'
import { formatPhoneDisplay, formatPhoneForStorage } from '@/lib/phone'
import { contactOnMatter } from '@/lib/contacts/assertContactOnMatter'

type Params = { params: Promise<{ id: string }> }

type ContactBody = {
  first_name?: string
  middle_name?: string
  last_name?: string
  suffix?: string
  preferred_name?: string
  preferred_pronoun?: string
  relationship?: string
  phone?: string
  email?: string
  address?: string
  date_of_birth?: string
}

function mapContact(contact: {
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  relationship_type: string | null
  relationship_label: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  date_of_birth?: string | null
}) {
  return {
    id: contact.id,
    first_name: contact.first_name,
    middle_name: contact.middle_name ?? null,
    last_name: contact.last_name,
    suffix: contact.suffix ?? null,
    preferred_name: contact.preferred_name ?? null,
    preferred_pronoun: contact.preferred_pronoun ?? null,
    relationship: contact.relationship_label ?? contact.relationship_type,
    phone: formatPhoneDisplay(contact.phone),
    email: contact.email,
    address: contact.address_line1,
    date_of_birth: contact.date_of_birth ?? null,
  }
}

export async function POST(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as ContactBody | null

  const firstName = body?.first_name?.trim()
  const middleName = body?.middle_name?.trim()
  const lastName = body?.last_name?.trim()

  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const { data: matter, error: matterError } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .maybeSingle()

    if (matterError) throw new Error(matterError.message)
    if (!matter?.client_intake_id) throw new Error('This matter is missing a client intake record.')

    const relationshipType = normalizeContactRelationshipType(body?.relationship, body?.relationship)

    const { data: contact, error } = await admin
      .from('contacts')
      .insert({
        client_intake_id: matter.client_intake_id,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        suffix: body?.suffix?.trim() || null,
        preferred_name: body?.preferred_name?.trim() || null,
        preferred_pronoun: body?.preferred_pronoun?.trim() || null,
        relationship_type: relationshipType,
        relationship_label: body?.relationship?.trim() || null,
        phone: formatPhoneForStorage(body?.phone),
        email: body?.email?.trim() || null,
        address_line1: body?.address?.trim() || null,
        date_of_birth: body?.date_of_birth?.trim() || null,
      })
      .select('id, first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, relationship_type, relationship_label, phone, email, address_line1, date_of_birth')
      .single()

    if (error) throw new Error(error.message)

    if (relationshipType === 'child') {
      await syncChildrenProjection(admin, matter.client_intake_id as string)
    }

    return NextResponse.json({
      contact: mapContact(contact),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to add contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as (ContactBody & { id?: string }) | null
  const contactId = body?.id?.trim()
  const firstName = body?.first_name?.trim()
  const middleName = body?.middle_name?.trim()
  const lastName = body?.last_name?.trim()

  if (!contactId) {
    return NextResponse.json({ error: 'Contact id is required' }, { status: 400 })
  }
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const { data: matter, error: matterError } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .maybeSingle()

    if (matterError) throw new Error(matterError.message)
    if (!matter?.client_intake_id) throw new Error('This matter is missing a client intake record.')

    const { data: contact, error } = await admin
      .from('contacts')
      .update({
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        suffix: body?.suffix?.trim() || null,
        preferred_name: body?.preferred_name?.trim() || null,
        preferred_pronoun: body?.preferred_pronoun?.trim() || null,
        relationship_type: normalizeContactRelationshipType(body?.relationship, body?.relationship),
        relationship_label: body?.relationship?.trim() || null,
        phone: formatPhoneForStorage(body?.phone),
        email: body?.email?.trim() || null,
        address_line1: body?.address?.trim() || null,
        date_of_birth: body?.date_of_birth?.trim() || null,
      })
      .eq('id', contactId)
      .eq('client_intake_id', matter.client_intake_id)
      .select('id, first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, relationship_type, relationship_label, phone, email, address_line1, date_of_birth')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found for this matter' }, { status: 404 })
    }

    return NextResponse.json({ contact: mapContact(contact) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const contactId = new URL(req.url).searchParams.get('contactId')
  if (!contactId) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const { data: matter, error: matterError } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .maybeSingle()

    if (matterError) throw new Error(matterError.message)
    if (!matter?.client_intake_id) throw new Error('This matter is missing a client intake record.')

    const intakeId = matter.client_intake_id as string

    // Scoped to the matter rather than the household — see
    // lib/contacts/assertContactOnMatter.ts.
    const { onMatter, relationshipType } = await contactOnMatter(admin, matterId, contactId)
    if (!onMatter) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    if (relationshipType === 'spouse') {
      return NextResponse.json(
        { error: 'The spouse is managed from the intake — edit the spouse fields to change or remove it.' },
        { status: 409 },
      )
    }

    const { data: deletedCount, error } = await admin.rpc('delete_intake_contact', {
      p_contact_id: contactId,
      p_client_intake_id: intakeId,
    })

    if (error) throw new Error(error.message)
    if (!deletedCount) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to remove contact'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
