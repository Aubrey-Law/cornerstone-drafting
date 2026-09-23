import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/contacts/[id]/sms-messages
 *
 * This person's own texts only. Deliberately not the household's: a contact
 * may inherit a matter_id for filtering, but showing a trustee the client's
 * whole SMS history under the trustee's name is what this route exists to
 * stop doing.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: contactId } = await params

  const { data, error } = await getAdminClient()
    .from('sms_messages')
    .select(
      'id, direction, recipient_role, recipient_name, body, status, from_number, to_number, created_at, sent_at, actor_name, read_by_staff_at',
    )
    .eq('contact_id', contactId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data ?? [])
}
