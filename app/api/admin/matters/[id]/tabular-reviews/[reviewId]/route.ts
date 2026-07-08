import { NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { requireAdmin } from '@/lib/apiAuth'
import { loadR2Bytes } from '@/lib/documentApiHelpers'
import { completeLlmText, resolveLlmConfig } from '@/lib/llm'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * GET /api/admin/matters/[id]/tabular-reviews/[reviewId]
 * POST …/generate — fill pending cells for one or all documents
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; reviewId: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId, reviewId } = await params
  const admin = getAdminClient()
  const { data: review, error } = await admin
    .from('tabular_reviews')
    .select('*')
    .eq('id', reviewId)
    .eq('matter_id', matterId)
    .maybeSingle()
  if (error || !review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: cells } = await admin
    .from('tabular_cells')
    .select('*')
    .eq('review_id', reviewId)
    .order('document_id')
    .order('column_index')

  return NextResponse.json({ review, cells: cells ?? [] })
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; reviewId: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId, reviewId } = await params
  const body = (await req.json().catch(() => ({}))) as { documentId?: string; action?: string }
  if (body.action && body.action !== 'generate') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: review } = await admin
    .from('tabular_reviews')
    .select('*')
    .eq('id', reviewId)
    .eq('matter_id', matterId)
    .maybeSingle()
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const columns = (review.columns_config ?? []) as Array<{
    index: number
    name: string
    prompt: string
  }>
  const documentIds = (
    body.documentId
      ? [body.documentId]
      : ((review.document_ids ?? []) as string[])
  ).filter(Boolean)

  if (documentIds.length === 0) {
    return NextResponse.json({ error: 'No documents in this review' }, { status: 400 })
  }

  const llmResolved = await resolveLlmConfig(admin, user.id)
  if (!llmResolved.ok) {
    return NextResponse.json({ error: llmResolved.error }, { status: 501 })
  }
  const llm = llmResolved.config

  const { data: docs } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .in('id', documentIds)

  const updatedCells: unknown[] = []

  for (const doc of docs ?? []) {
    let text = ''
    try {
      const bytes = await loadR2Bytes(doc.r2_key)
      if (doc.name.toLowerCase().endsWith('.docx')) {
        const { value } = await mammoth.extractRawText({ buffer: bytes })
        text = value.slice(0, 60_000)
      } else {
        text = bytes.toString('utf8').slice(0, 60_000)
      }
    } catch (e) {
      console.warn('[tabular] extract failed', doc.id, e)
      continue
    }

    const { data: pendingCells } = await admin
      .from('tabular_cells')
      .select('*')
      .eq('review_id', reviewId)
      .eq('document_id', doc.id)
      .in('status', ['pending', 'error'])

    if (!pendingCells?.length) continue

    await admin
      .from('tabular_cells')
      .update({ status: 'generating', updated_at: new Date().toISOString() })
      .eq('review_id', reviewId)
      .eq('document_id', doc.id)
      .in('status', ['pending', 'error'])

    const columnBlock = columns
      .map(c => `[${c.index}] ${c.name}: ${c.prompt}`)
      .join('\n')

    try {
      const prompt = `You are reviewing an estate planning document for consistency.

Document: ${doc.name}
---
${text}
---

Answer EACH column. Return ONLY a JSON array:
[{"index":0,"content":"...","citations":[{"quote":"..."}]}]

Columns:
${columnBlock}`

      const response = await completeLlmText(llm, {
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 3000,
      })
      const raw = response.text
      const match = raw.match(/\[[\s\S]*\]/)
      const answers = match ? (JSON.parse(match[0]) as Array<{ index: number; content: string; citations?: unknown }>) : []

      for (const col of columns) {
        const answer = answers.find(a => a.index === col.index)
        const { data: cell } = await admin
          .from('tabular_cells')
          .update({
            content: answer?.content ?? '',
            citations: answer?.citations ?? [],
            status: answer ? 'done' : 'error',
            error_message: answer ? null : 'No answer returned',
            updated_at: new Date().toISOString(),
          })
          .eq('review_id', reviewId)
          .eq('document_id', doc.id)
          .eq('column_index', col.index)
          .select('*')
          .maybeSingle()
        if (cell) updatedCells.push(cell)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await admin
        .from('tabular_cells')
        .update({ status: 'error', error_message: msg, updated_at: new Date().toISOString() })
        .eq('review_id', reviewId)
        .eq('document_id', doc.id)
        .eq('status', 'generating')
    }
  }

  await admin
    .from('tabular_reviews')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', reviewId)

  const { data: cells } = await admin.from('tabular_cells').select('*').eq('review_id', reviewId)
  return NextResponse.json({ cells: cells ?? [], updated: updatedCells.length })
}
