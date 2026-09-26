import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'
import { filePriorPlan, listPriorPlans } from '@/lib/documents/priorPlans'

/**
 * Prior plans linked to a matter from the review workbench, and filing one as
 * a matter document. Staff only: a client never sees an upload until an
 * attorney files it and then shares it.
 */

type Authorized =
  | { ok: true; admin: ReturnType<typeof getAdminClient>; userId: string }
  | { ok: false; response: NextResponse }

async function authorize(req: Request, matterId: string): Promise<Authorized> {
  const user = await getBearerUser(req)
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!matterId) return { ok: false, response: NextResponse.json({ error: 'Missing matterId' }, { status: 400 }) }
  const admin = getAdminClient()
  if (!(await isAdminUser(admin, user)) || !(await userCanAccessMatter(admin, user, matterId))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, admin, userId: user.id }
}

// GET /api/documents/prior-plans?matterId=…
export async function GET(req: Request) {
  const matterId = new URL(req.url).searchParams.get('matterId')?.trim() ?? ''
  const auth = await authorize(req, matterId)
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json({ priorPlans: await listPriorPlans(auth.admin, matterId) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not list prior plans' }, { status: 500 })
  }
}

// POST /api/documents/prior-plans { matterId, reviewUploadId }
export async function POST(req: Request) {
  let body: { matterId?: unknown; reviewUploadId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const matterId = typeof body.matterId === 'string' ? body.matterId.trim() : ''
  const reviewUploadId = typeof body.reviewUploadId === 'string' ? body.reviewUploadId.trim() : ''

  const auth = await authorize(req, matterId)
  if (!auth.ok) return auth.response
  if (!reviewUploadId) return NextResponse.json({ error: 'Missing reviewUploadId' }, { status: 400 })

  const result = await filePriorPlan(auth.admin, { matterId, reviewUploadId, userId: auth.userId })
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status })
  return NextResponse.json({ document: result.document, alreadyFiled: result.alreadyFiled })
}

export const runtime = 'nodejs'
