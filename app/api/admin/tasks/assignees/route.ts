import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchTaskAssignees } from '@/lib/queries/tasks'

/** Staff who can own a task — the assignee dropdown and the composer chip. */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const assignees = await fetchTaskAssignees()
  return NextResponse.json({ assignees, viewerId: auth.userId })
}
