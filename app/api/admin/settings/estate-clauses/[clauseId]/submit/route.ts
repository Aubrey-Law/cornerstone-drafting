import { requireAdmin } from '@/lib/apiAuth'
import {
  submitEstateClauseDraft,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import { getAdminClient } from '@/lib/supabaseAdmin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

function workflowStatus(message: string) {
  if (/not found|no row/i.test(message)) return 404
  if (/valid|stale|current revision|conflict/i.test(message)) return 409
  return 500
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clauseId: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { clauseId } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const workingDraftId = body?.workingDraftId
  if (!userId || !isUuid(clauseId) || !isUuid(workingDraftId)) {
    return Response.json({ error: 'Valid clause and working draft identifiers are required' }, { status: 400 })
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const { data: draft, error } = await client
      .from('estate_clause_working_drafts')
      .select('id,clause_id,author_id,validation_status')
      .eq('id', workingDraftId)
      .eq('clause_id', clauseId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!draft) return Response.json({ error: 'Estate clause draft not found' }, { status: 404 })
    const row = draft as { author_id: string; validation_status: string }
    if (row.author_id !== userId) return Response.json({ error: 'Only the draft author may submit it' }, { status: 403 })

    const revisionId = await submitEstateClauseDraft({ client, workingDraftId, actorId: userId })
    return Response.json({ revisionId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to submit estate clause draft'
    return Response.json({ error: message }, { status: workflowStatus(message) })
  }
}
