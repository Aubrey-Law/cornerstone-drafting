import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  return NextResponse.json({ error: 'Browser calling has been retired.' }, { status: 410 })
}
