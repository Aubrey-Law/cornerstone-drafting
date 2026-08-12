import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  ContactChannelError,
  normalizeContactChannels,
  parseContactChannels,
  type ContactChannelKind,
} from '@/lib/contacts/additionalChannels'

type Params = { params: Promise<{ id: string }> }

const FIELDS = {
  additional_emails: 'email',
  additional_phones: 'phone',
} as const satisfies Record<string, ContactChannelKind>

type ChannelField = keyof typeof FIELDS

/**
 * PATCH /api/admin/leads/[id]/channels
 *
 * Body: { target: 'client' | 'spouse', field: 'additional_emails' |
 * 'additional_phones', value: [{label, value}] }
 *
 * Secondary addresses are contact detail, not lead qualification: they carry no
 * lifecycle meaning, gate nothing, and belong to the person rather than the
 * opportunity. That is why they are written here rather than through
 * `update_lead_opportunity_field`, whose whitelist exists to audit the fields
 * that do move a lead along.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: leadId } = await params
  const body = (await req.json().catch(() => null)) as
    | { target?: string; field?: string; value?: unknown }
    | null

  const target = body?.target
  const field = body?.field as ChannelField | undefined
  if (target !== 'client' && target !== 'spouse') {
    return NextResponse.json({ error: 'target must be client or spouse' }, { status: 400 })
  }
  if (!field || !(field in FIELDS)) {
    return NextResponse.json(
      { error: 'field must be additional_emails or additional_phones' },
      { status: 400 },
    )
  }

  const admin = getAdminClient()
  const kind = FIELDS[field]
  const primaryColumn = kind === 'email' ? 'email' : 'phone'

  const row = target === 'client'
    ? await admin.from('client_intake').select(`id, ${primaryColumn}`).eq('id', leadId).maybeSingle()
    : await admin
        .from('contacts')
        .select(`id, ${primaryColumn}`)
        .eq('client_intake_id', leadId)
        .eq('relationship_type', 'spouse')
        .maybeSingle()
  if (row.error) return NextResponse.json({ error: row.error.message }, { status: 500 })
  if (!row.data) {
    return NextResponse.json(
      { error: target === 'client' ? 'Lead not found' : 'This lead has no spouse on file' },
      { status: 404 },
    )
  }

  let channels
  try {
    channels = normalizeContactChannels(
      body?.value,
      kind,
      (row.data as Record<string, string | null>)[primaryColumn] ?? null,
    )
  } catch (error) {
    if (error instanceof ContactChannelError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  const { error: updateError } = target === 'client'
    ? await admin.from('client_intake').update({ [field]: channels }).eq('id', leadId)
    : await admin.from('contacts').update({ [field]: channels }).eq('id', (row.data as { id: string }).id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ target, field, value: parseContactChannels(channels) })
}
