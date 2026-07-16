import { requireAdmin } from '@/lib/apiAuth'
import {
  listEstateClauses,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import type { EstateDocumentType } from '@/lib/estateClauses/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

const DOCUMENT_TYPES = new Set<EstateDocumentType>([
  'will',
  'trust',
  'durable_power_of_attorney',
  'health_care_directive',
  'hipaa_authorization',
  'ancillary',
])

function validDocumentTypes(value: unknown): value is EstateDocumentType[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string' && DOCUMENT_TYPES.has(item as EstateDocumentType))
    && new Set(value).size === value.length
}

export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const clauses = await listEstateClauses({ client })
    const [draftsResult, revisionsResult, eventsResult, publicationsResult] = await Promise.all([
      client
        .from('estate_clause_working_drafts')
        .select('id,clause_id,author_id,base_published_revision_id,source_review_revision_id,clause_text,required_fields,nested_clause_keys,condition_field,change_summary,content_hash,validation_status,validation_report,updated_at')
        .eq('author_id', userId),
      client
        .from('estate_clause_revisions')
        .select('id,clause_id,revision_number,author_id,base_published_revision_id,clause_text,required_fields,nested_clause_keys,condition_field,change_summary,content_hash,validation_status,validation_report,submitted_at')
        .order('revision_number', { ascending: false }),
      client
        .from('estate_clause_review_events')
        .select('id,clause_id,revision_id,event_type,actor_id,comment,validation_report,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false }),
      client
        .from('estate_clause_publications')
        .select('clause_id,current_revision_id,published_by,published_at,updated_at'),
    ])
    for (const result of [draftsResult, revisionsResult, eventsResult, publicationsResult]) {
      if (result.error) throw new Error(result.error.message)
    }

    type DraftRow = {
      id: string; clause_id: string; author_id: string; base_published_revision_id: string | null; source_review_revision_id: string | null
      clause_text: string; required_fields: string[]; nested_clause_keys: string[]; condition_field: string | null
      change_summary: string; content_hash: string; validation_status: string; validation_report: unknown; updated_at: string
    }
    type RevisionRow = {
      id: string; clause_id: string; revision_number: number; author_id: string; base_published_revision_id: string | null
      clause_text: string; required_fields: string[]; nested_clause_keys: string[]; condition_field: string | null
      change_summary: string; content_hash: string; validation_status: string; validation_report: unknown; submitted_at: string
    }
    type EventRow = {
      id: string; clause_id: string; revision_id: string; event_type: string; actor_id: string
      comment: string | null; validation_report: unknown; created_at: string
    }
    type PublicationRow = {
      clause_id: string; current_revision_id: string; published_by: string; published_at: string; updated_at: string
    }
    const drafts = (draftsResult.data ?? []) as DraftRow[]
    const revisions = (revisionsResult.data ?? []) as RevisionRow[]
    const events = (eventsResult.data ?? []) as EventRow[]
    const publications = (publicationsResult.data ?? []) as PublicationRow[]
    const latestEventByRevision = new Map<string, EventRow>()
    for (const event of events) {
      if (!latestEventByRevision.has(event.revision_id)) latestEventByRevision.set(event.revision_id, event)
    }

    const revisionDto = (revision: RevisionRow) => ({
      id: revision.id,
      clauseId: revision.clause_id,
      revisionNumber: revision.revision_number,
      authorId: revision.author_id,
      basePublishedRevisionId: revision.base_published_revision_id,
      text: revision.clause_text,
      requiredFields: revision.required_fields,
      nestedClauseKeys: revision.nested_clause_keys,
      conditionField: revision.condition_field,
      changeSummary: revision.change_summary,
      contentHash: revision.content_hash,
      validationStatus: revision.validation_status,
      validationReport: revision.validation_report,
      submittedAt: revision.submitted_at,
      latestReviewEvent: latestEventByRevision.get(revision.id) ?? null,
    })

    return Response.json({
      clauses: clauses.map(clause => {
        const draft = drafts.find(row => row.clause_id === clause.id) ?? null
        const changedRevision = draft
          ? revisions.find(row => (
            row.id === draft.source_review_revision_id
            && row.clause_id === clause.id
            && row.author_id === draft.author_id
            && latestEventByRevision.get(row.id)?.event_type === 'changes_requested'
          )) ?? null
          : null
        const changeRequest = changedRevision ? latestEventByRevision.get(changedRevision.id) ?? null : null
        const publication = publications.find(row => row.clause_id === clause.id) ?? null
        const currentRevision = publication
          ? revisions.find(row => row.id === publication.current_revision_id) ?? null
          : null
        return {
          ...clause,
          workingDraft: draft ? {
            id: draft.id,
            clauseId: draft.clause_id,
            authorId: draft.author_id,
            basePublishedRevisionId: draft.base_published_revision_id,
            text: draft.clause_text,
            requiredFields: draft.required_fields,
            nestedClauseKeys: draft.nested_clause_keys,
            conditionField: draft.condition_field,
            changeSummary: draft.change_summary,
            contentHash: draft.content_hash,
            validationStatus: draft.validation_status,
            validationReport: draft.validation_report,
            updatedAt: draft.updated_at,
          } : null,
          latestChangeRequest: changedRevision && changeRequest ? {
            revisionId: changedRevision.id,
            revisionNumber: changedRevision.revision_number,
            comment: changeRequest.comment,
            reviewerId: changeRequest.actor_id,
            createdAt: changeRequest.created_at,
          } : null,
          submittedRevisions: revisions
            .filter(row => row.clause_id === clause.id && latestEventByRevision.get(row.id)?.event_type === 'submitted')
            .map(revisionDto),
          currentPublication: publication && currentRevision
            ? { ...publication, revision: revisionDto(currentRevision) }
            : null,
          reviewEvents: events.filter(row => row.clause_id === clause.id),
        }
      }),
    })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to list estate clauses' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const clauseKey = typeof body?.clauseKey === 'string' ? body.clauseKey.trim() : ''
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const documentTypes = body?.documentTypes
  if (
    !userId
    || !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(clauseKey)
    || !title
    || !validDocumentTypes(documentTypes)
  ) {
    return Response.json({ error: 'A stable clause key, title, and compatible document types are required' }, { status: 400 })
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const { data, error } = await client
      .from('estate_clauses')
      .insert({
        clause_key: clauseKey,
        title,
        jurisdiction: 'MA',
        document_types: documentTypes,
        created_by: userId,
      })
      .select('id,clause_key,title,jurisdiction,document_types,is_active,created_at,updated_at')
      .single()
    if (error) {
      const status = /duplicate|unique/i.test(error.message) ? 409 : 500
      return Response.json({ error: error.message }, { status })
    }
    const row = data as {
      id: string
      clause_key: string
      title: string
      jurisdiction: 'MA'
      document_types: EstateDocumentType[]
      is_active: boolean
      created_at: string
      updated_at: string
    }
    return Response.json({
      clause: {
        id: row.id,
        clauseKey: row.clause_key,
        title: row.title,
        jurisdiction: row.jurisdiction,
        documentTypes: row.document_types,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    }, { status: 201 })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to create estate clause' }, { status: 500 })
  }
}
