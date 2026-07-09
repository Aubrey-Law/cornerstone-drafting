import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchOpenStageTasksForMatter } from '@/lib/queries/stageTasks'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const tasks = await fetchOpenStageTasksForMatter(id)
  return NextResponse.json({ tasks })
}
