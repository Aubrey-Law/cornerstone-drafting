import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { loadCeremony } from '@/lib/ceremony/repository'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { isUuid } from '@/lib/queries/tasks'
import { reviewClient } from '@/lib/review/staff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/matters/[id]/signing
 *
 * What the matter's drafted documents need to be signed properly, read from
 * their names, and the record of the signing appointment. Read by the Signing
 * view of the matter's Documents tab. `signing: null` means the matter is not
 * hired, so there is nothing to sign yet.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  try {
    const client = reviewClient()
    const [matter] = await loadExecutionMatters(client, { matterId: id })
    if (!matter) return NextResponse.json({ signing: null })
    const detected = detectKinds(matter.documentNames)
    const ceremony = await loadCeremony(client, id)
    return NextResponse.json({
      signing: { kinds: detected.kinds, unmatched: detected.unmatched, ceremony },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load the signing' },
      { status: 500 },
    )
  }
}
