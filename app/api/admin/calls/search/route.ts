import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

/** Search matters and prospective leads for call assignment. */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (!q) return NextResponse.json({ matters: [], leads: [] })

  const admin = getAdminClient()
  const pattern = `%${q}%`

  const [{ data, error }, { data: leadData, error: leadError }] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id, matter_name, client_name, client_email, client_phone')
      .or(
        `client_name.ilike.${pattern},client_email.ilike.${pattern},client_phone.ilike.${pattern},matter_name.ilike.${pattern}`,
      )
      .limit(15),
    admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, email, phone')
      .is('matter_id', null)
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
      )
      .order('updated_at', { ascending: false })
      .limit(15),
  ])

  if (error) {
    // Fallback: search client_intake + matters if view filter fails
    const { data: intakes } = await admin
      .from('client_intake')
      .select('id, first_name, last_name, email, phone, matter_id')
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`,
      )
      .not('matter_id', 'is', null)
      .limit(15)

    const matters = (intakes ?? []).map((ci) => ({
      id: ci.matter_id as string,
      label:
        `${ci.first_name ?? ''} ${ci.last_name ?? ''}`.trim() +
        (ci.email ? ` · ${ci.email}` : ''),
    }))
    const leads = leadError ? [] : (leadData ?? []).map((lead) => ({
      id: lead.id as string,
      label:
        (lead.full_name?.trim() || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Unnamed lead') +
        (lead.email ? ` · ${lead.email}` : ''),
    }))
    return NextResponse.json({ matters, leads })
  }

  const matters = (data ?? []).map((m) => ({
    id: m.matter_id as string,
    label:
      (m.client_name?.trim() || m.matter_name || m.matter_id.slice(0, 8)) +
      (m.client_email ? ` · ${m.client_email}` : ''),
  }))

  const leads = leadError ? [] : (leadData ?? []).map((lead) => ({
    id: lead.id as string,
    label:
      (lead.full_name?.trim() || `${lead.first_name ?? ''} ${lead.last_name ?? ''}`.trim() || 'Unnamed lead') +
      (lead.email ? ` · ${lead.email}` : ''),
  }))

  return NextResponse.json({ matters, leads })
}
