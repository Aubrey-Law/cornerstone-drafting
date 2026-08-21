import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { releaseMatterFeeMilestone } from '@/lib/billing/schedules'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  try {
    const milestone = await releaseMatterFeeMilestone((await params).id, auth.userId!)
    return NextResponse.json({ milestone })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not release milestone' }, { status: 409 })
  }
}
