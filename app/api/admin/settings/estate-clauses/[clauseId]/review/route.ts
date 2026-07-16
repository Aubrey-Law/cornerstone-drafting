import { requireAdmin } from '@/lib/apiAuth'
import {
  publishEstateClauseRevision,
  requestEstateClauseChanges,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import { getAdminClient } from '@/lib/supabaseAdmin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

type ReviewBody =
  | { action: 'request_changes'; comment: string }
  | { action: 'publish'; expectedCurrentRevisionId: string | null }

function parseReviewBody(value: unknown): ReviewBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (body.action === 'request_changes') {
    if (Object.keys(body).some(key => !['action', 'comment'].includes(key))) return null
    const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
    return comment ? { action: 'request_changes', comment } : null
  }
  if (body.action === 'publish') {
    if (Object.keys(body).some(key => !['action', 'expectedCurrentRevisionId'].includes(key))) return null
    const expected = body.expectedCurrentRevisionId
    return expected === null || isUuid(expected)
      ? { action: 'publish', expectedCurrentRevisionId: expected }
      : null
  }
  return null
}

function workflowStatus(message: string) {
  if (/different attorney|different administrator/i.test(message)) return 403
  if (/not found|no row/i.test(message)) return 404
  if (/valid|stale|current revision|conflict|changed/i.test(message)) return 409
  return 500
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clauseId: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { clauseId } = await params
  const body = parseReviewBody(await req.json().catch(() => null))
  if (!userId || !isUuid(clauseId) || !body) {
    return Response.json({ error: 'A valid review action is required' }, { status: 400 })
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const { data: revision, error: revisionError } = await client
      .from('estate_clause_revisions')
      .select('id,clause_id,author_id,validation_status')
      .eq('clause_id', clauseId)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (revisionError) throw new Error(revisionError.message)
    if (!revision) return Response.json({ error: 'Submitted estate clause revision not found' }, { status: 404 })
    const revisionRow = revision as { id: string; author_id: string; validation_status: string }
    const { data: latestEvent, error: eventError } = await client
      .from('estate_clause_review_events')
      .select('event_type')
      .eq('revision_id', revisionRow.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (eventError) throw new Error(eventError.message)
    if (!latestEvent || (latestEvent as { event_type: string }).event_type !== 'submitted') {
      return Response.json({ error: 'Submitted estate clause revision not found' }, { status: 404 })
    }
    if (revisionRow.author_id === userId) {
      return Response.json({ error: 'A different attorney or administrator must review this revision.' }, { status: 403 })
    }

    if (body.action === 'request_changes') {
      const eventId = await requestEstateClauseChanges({
        client,
        revisionId: revisionRow.id,
        actorId: userId,
        authorId: revisionRow.author_id,
        comment: body.comment,
      })
      return Response.json({ eventId })
    }

    if (revisionRow.validation_status !== 'valid') {
      return Response.json({ error: 'Estate clause revision failed validation' }, { status: 409 })
    }
    const { data: publication, error: publicationError } = await client
      .from('estate_clause_publications')
      .select('current_revision_id')
      .eq('clause_id', clauseId)
      .maybeSingle()
    if (publicationError) throw new Error(publicationError.message)
    const currentRevisionId = publication
      ? (publication as { current_revision_id: string }).current_revision_id
      : null
    if (currentRevisionId !== body.expectedCurrentRevisionId) {
      return Response.json({ error: 'The current publication changed; reload before publishing' }, { status: 409 })
    }

    const publicationId = await publishEstateClauseRevision({
      client,
      revisionId: revisionRow.id,
      actorId: userId,
      authorId: revisionRow.author_id,
      expectedCurrentRevisionId: currentRevisionId,
    })
    return Response.json({ publicationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to review estate clause revision'
    return Response.json({ error: message }, { status: workflowStatus(message) })
  }
}
