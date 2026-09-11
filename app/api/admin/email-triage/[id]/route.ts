import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'

export const dynamic = 'force-dynamic'

// PATCH /api/admin/email-triage/[id] — save the attorney's edits to a draft.
// Autosaved from the editor, so it is deliberately permissive about partial
// bodies and never changes status: editing a draft is not approving it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.draftSubject === 'string') patch.draft_subject = body.draftSubject
  if (typeof body.draftBody === 'string') patch.draft_body = body.draftBody
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await getAdminClient()
    .from('email_triage_threads')
    .update(patch)
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ row: await fetchEmailTriageRow(id) })
}
