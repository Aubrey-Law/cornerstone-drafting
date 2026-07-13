import { NextRequest, NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const { err } = await requireAdministrator(req)
  if (err) return err

  const query = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (query.length < 2) return NextResponse.json({ matters: [] })

  const admin = getAdminClient()
  const safeTerm = query.replace(/[%,().]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!UUID_PATTERN.test(query) && safeTerm.length < 2) {
    return NextResponse.json({ matters: [] })
  }
  const base = admin
    .from('v_matter_pipeline')
    .select('matter_id, matter_name, client_name, client_email, stage')
    .limit(12)

  const { data, error } = UUID_PATTERN.test(query)
    ? await base.eq('matter_id', query)
    : await base.or(
      `matter_name.ilike.%${safeTerm}%,client_name.ilike.%${safeTerm}%,client_email.ilike.%${safeTerm}%`,
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    matters: (data ?? []).map(matter => ({
      id: matter.matter_id as string,
      label: matter.client_name?.trim() || matter.matter_name?.trim() || 'Untitled matter',
      matterName: matter.matter_name ?? null,
      email: matter.client_email ?? null,
      stage: matter.stage ?? null,
    })),
  })
}

export const runtime = 'nodejs'
