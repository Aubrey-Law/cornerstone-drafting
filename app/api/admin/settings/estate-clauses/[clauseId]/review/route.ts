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
  if (/valid|stale|current revision|conflict|changed|awaiting review|different publication|base publication/i.test(message)) return 409
  return 500
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ clauseId: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { clauseId } = await params
  const revisionId = new URL(req.url).searchParams.get('revisionId')
  const body = parseReviewBody(await req.json().catch(() => null))
  if (!userId || !isUuid(clauseId) || !isUuid(revisionId) || !body) {
    return Response.json({ error: 'A valid review action is required' }, { status: 400 })
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const { data: revisions, error: revisionError } = await client
      .from('estate_clause_revisions')
      .select('id,clause_id,author_id,validation_status')
      .eq('clause_id', clauseId)
      .order('revision_number', { ascending: false })
    if (revisionError) throw new Error(revisionError.message)
    const revisionRows = (revisions ?? []) as Array<{ id: string; author_id: string; validation_status: string }>
    const { data: events, error: eventError } = await client
      .from('estate_clause_review_events')
      .select('id,revision_id,event_type,created_at')
      .eq('clause_id', clauseId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
    if (eventError) throw new Error(eventError.message)
    const latestEventByRevision = new Map<string, string>()
    for (const event of (events ?? []) as Array<{ revision_id: string; event_type: string }>) {
      if (!latestEventByRevision.has(event.revision_id)) latestEventByRevision.set(event.revision_id, event.event_type)
    }
    const pendingRevisions = revisionRows.filter(row => row.id === revisionId && latestEventByRevision.get(row.id) === 'submitted')
    if (pendingRevisions.length === 0) return Response.json({ error: 'Submitted estate clause revision not found' }, { status: 404 })
    const revisionRow = pendingRevisions[0]
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
