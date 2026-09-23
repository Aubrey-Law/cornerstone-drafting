import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { softDeleteSmsMessage } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DELETE /api/admin/texts/messages/[id] — hide one text from the Texts page,
 * record cards and badges. Soft: the row keeps its content with who deleted
 * it and when. The recipient's copy is unaffected.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid message id' }, { status: 400 })
  try {
    const deleted = await softDeleteSmsMessage(id, userId as string)
    if (!deleted) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    revalidateSidebarCounts()
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete message' },
      { status: 500 },
    )
  }
}
