import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { syncSystemWorkflows } from '@/lib/works/systemSync'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  try {
    const result = await syncSystemWorkflows()
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'System skill sync failed' },
      { status: 500 },
    )
  }
}
