import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'

export async function POST(req: Request, _context?: unknown) {
  const { err } = await requireAdmin(req)
  if (err) return err
  return NextResponse.json({ error: 'Texting has been retired. Use your external communications service.' }, { status: 410 })
}
