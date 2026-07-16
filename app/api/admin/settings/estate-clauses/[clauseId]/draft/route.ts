import { requireAdmin } from '@/lib/apiAuth'
import {
  listEstateClauses,
  saveEstateClauseDraft,
  type EstateClauseClient,
} from '@/lib/estateClauses/repository'
import type { EstateClauseContent } from '@/lib/estateClauses/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const stringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim().length > 0)
)

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ clauseId: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { clauseId } = await params
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const contentValue = body?.content
  const contentBody = contentValue && typeof contentValue === 'object' && !Array.isArray(contentValue)
    ? contentValue as Record<string, unknown>
    : null
  const changeSummary = typeof body?.changeSummary === 'string' ? body.changeSummary.trim() : ''
  const conditionField = contentBody?.conditionField
  const basePublishedRevisionId = body?.basePublishedRevisionId ?? null

  if (
    !userId
    || !isUuid(clauseId)
    || (basePublishedRevisionId !== null && !isUuid(basePublishedRevisionId))
    || typeof contentBody?.text !== 'string'
    || !contentBody.text.trim()
    || !stringArray(contentBody.requiredFields)
    || !stringArray(contentBody.nestedClauseKeys)
    || !(conditionField === null || conditionField === undefined || (typeof conditionField === 'string' && conditionField.trim()))
    || !changeSummary
  ) {
    return Response.json({ error: 'Valid clause draft content and change summary are required' }, { status: 400 })
  }

  const content: EstateClauseContent = {
    text: contentBody.text.trim(),
    requiredFields: contentBody.requiredFields.map(item => item.trim()),
    nestedClauseKeys: contentBody.nestedClauseKeys.map(item => item.trim()),
    conditionField: typeof conditionField === 'string' ? conditionField.trim() : null,
  }

  try {
    const client = getAdminClient() as unknown as EstateClauseClient
    const clauses = await listEstateClauses({ client })
    if (!clauses.some(clause => clause.id === clauseId)) {
      return Response.json({ error: 'Estate clause not found' }, { status: 404 })
    }
    const draft = await saveEstateClauseDraft({
      client,
      clauseId,
      authorId: userId,
      basePublishedRevisionId: basePublishedRevisionId as string | null,
      content,
      changeSummary,
      catalog: new Set(clauses.map(clause => clause.clauseKey)),
    })
    return Response.json({ draft })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to save estate clause draft' }, { status: 500 })
  }
}
