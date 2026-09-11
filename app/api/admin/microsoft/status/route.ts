import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getStoredCalendarConnection, deleteCalendarConnection } from '@/lib/calendarConnections'

/**
 * The retired Outlook connection: report it, or remove it.
 *
 * There is no connect counterpart. Microsoft 365 is no longer the firm's
 * calendar or mailbox, and this endpoint exists only so Settings can show what
 * is still stored — and let the attorney drop it once no appointment booked
 * before the switchover is still ahead.
 */
export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const conn = userId ? await getStoredCalendarConnection(userId, 'microsoft') : null

  return NextResponse.json({
    connected: Boolean(conn),
    email: conn?.email ?? null,
    scopes: conn?.scopes ?? null,
  })
}

export async function DELETE(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await deleteCalendarConnection(userId, 'microsoft')
  return NextResponse.json({ ok: true })
}
