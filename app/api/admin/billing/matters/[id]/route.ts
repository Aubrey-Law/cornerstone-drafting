import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchMatterBilling } from '@/lib/queries/billing'

type Context = { params: Promise<{ id: string }> }

const matterIdSchema = z.string().uuid()

/** GET /api/admin/billing/matters/[id] — billing rows for one matter. */
export async function GET(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const parsedId = matterIdSchema.safeParse((await params).id)
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })
  }

  try {
    return NextResponse.json(await fetchMatterBilling(parsedId.data))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load billing' },
      { status: 500 },
    )
  }
}
