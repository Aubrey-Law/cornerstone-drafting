import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchRecordTaskCounts, isUuid } from '@/lib/queries/tasks'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const recordId = new URL(req.url).searchParams.get('recordId')
  if (!recordId || !isUuid(recordId)) {
    return NextResponse.json({ error: 'A valid record is required.' }, { status: 400 })
  }
  try {
    const counts = await fetchRecordTaskCounts(recordId)
    return NextResponse.json({ counts })
  } catch {
    return NextResponse.json({ error: 'Task counts are unavailable. Please retry.' }, { status: 503 })
  }
}
