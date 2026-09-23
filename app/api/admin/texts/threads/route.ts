import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listSmsThreads, type SmsThreadFilter } from '@/lib/queries/smsThreads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FILTERS = new Set<SmsThreadFilter>(['all', 'unread', 'unknown'])

/** GET /api/admin/texts/threads?filter=all|unread|unknown&cursor=<iso> */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const params = req.nextUrl.searchParams
  const filterParam = params.get('filter') as SmsThreadFilter | null
  const filter = filterParam && FILTERS.has(filterParam) ? filterParam : 'all'
  try {
    const threads = await listSmsThreads({ filter, cursor: params.get('cursor') })
    return NextResponse.json({ threads })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load texts' },
      { status: 500 },
    )
  }
}
