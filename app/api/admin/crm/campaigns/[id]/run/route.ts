import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { dispatchDueCampaignDeliveries } from '@/lib/crm/campaignDispatch'

export const runtime = 'nodejs'
export const maxDuration = 120

const idSchema = z.string().uuid()
const runSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
})

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const id = await params.then(p => p.id)
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const parsedBody = runSchema.safeParse(body)
  if (!parsedBody.success) return NextResponse.json({ error: 'Invalid run payload' }, { status: 400 })

  try {
    return NextResponse.json(await dispatchDueCampaignDeliveries(parsedId.data, parsedBody.data.limit ?? 200))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Campaign dispatch failed' }, { status: 409 })
  }
}
