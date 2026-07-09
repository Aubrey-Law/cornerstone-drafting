import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchMatterAging } from '@/lib/queries/pipelineAging'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const aging = await fetchMatterAging()

  return NextResponse.json({
    rows: aging.rows,
    tiles: aging.tiles,
  })
}
