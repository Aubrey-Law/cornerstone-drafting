import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { GranolaError, listRecentNotes } from '@/lib/granola'

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const url = new URL(req.url)
  const sinceDaysRaw = url.searchParams.get('sinceDays')
  const sinceDays = Math.min(
    Math.max(Number.parseInt(sinceDaysRaw ?? '14', 10) || 14, 1),
    90,
  )

  try {
    const notes = await listRecentNotes(sinceDays)
    return NextResponse.json({ notes })
  } catch (e) {
    if (e instanceof GranolaError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[granola/list] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export const runtime = 'nodejs'
