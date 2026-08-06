import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { sanitizeEmailHtml } from '@/lib/email/templateShared'
import { getAdminClient } from '@/lib/supabaseAdmin'

type ContextType = 'matter' | 'lead' | 'contact' | 'general'

const CONTEXT_TYPES: ContextType[] = ['matter', 'lead', 'contact', 'general']

function contextFromUrl(req: Request): { contextType: ContextType; contextId: string | null } | null {
  const url = new URL(req.url)
  const contextType = url.searchParams.get('contextType') as ContextType | null
  const contextId = url.searchParams.get('contextId')?.trim() || null
  if (!contextType || !CONTEXT_TYPES.includes(contextType)) return null
  if (contextType === 'general' && contextId) return null
  if (contextType !== 'general' && !contextId) return null
  return { contextType, contextId }
}

function toDraft(row: Record<string, unknown>) {
  return {
    id: row.id,
    to: row.to_email,
    cc: row.cc,
    bcc: row.bcc,
    templateId: row.template_id,
    subject: row.subject,
    bodyHtml: row.body_html,
    documentIds: row.document_ids,
    includeSignature: row.include_signature,
    updatedAt: row.updated_at,
  }
}

function baseQuery(userId: string, contextType: ContextType, contextId: string | null) {
  let query = getAdminClient()
    .from('email_drafts')
    .select('*')
    .eq('user_id', userId)
    .eq('context_type', contextType)
  query = contextId ? query.eq('context_id', contextId) : query.is('context_id', null)
  return query
}

export async function GET(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const context = contextFromUrl(req)
  if (!context || !userId) return NextResponse.json({ error: 'Invalid draft context' }, { status: 400 })
  const { data, error } = await baseQuery(userId, context.contextType, context.contextId).maybeSingle()
  if (error) {
    if (error.message.includes('email_drafts')) return NextResponse.json({ draft: null, migrationRequired: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ draft: data ? toDraft(data as Record<string, unknown>) : null })
}

export async function PUT(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const context = contextFromUrl(req)
  if (!context || !userId) return NextResponse.json({ error: 'Invalid draft context' }, { status: 400 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : []
  const payload = {
    user_id: userId,
    context_type: context.contextType,
    context_id: context.contextId,
    to_email: typeof body.to === 'string' ? body.to.trim() : '',
    cc: strings(body.cc),
    bcc: strings(body.bcc),
    template_id: typeof body.templateId === 'string' && body.templateId !== 'none' ? body.templateId : null,
    subject: typeof body.subject === 'string' ? body.subject : '',
    body_html: typeof body.bodyHtml === 'string' ? sanitizeEmailHtml(body.bodyHtml) : '',
    document_ids: strings(body.documentIds),
    include_signature: body.includeSignature !== false,
    updated_at: new Date().toISOString(),
  }

  const existing = await baseQuery(userId, context.contextType, context.contextId).maybeSingle()
  if (existing.error && !existing.error.message.includes('email_drafts')) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 })
  }
  const result = existing.data
    ? await getAdminClient().from('email_drafts').update(payload).eq('id', existing.data.id).select('*').single()
    : await getAdminClient().from('email_drafts').insert(payload).select('*').single()
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ draft: toDraft(result.data as Record<string, unknown>) })
}

export async function DELETE(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const context = contextFromUrl(req)
  if (!context || !userId) return NextResponse.json({ error: 'Invalid draft context' }, { status: 400 })
  let query = getAdminClient()
    .from('email_drafts')
    .delete()
    .eq('user_id', userId)
    .eq('context_type', context.contextType)
  query = context.contextId ? query.eq('context_id', context.contextId) : query.is('context_id', null)
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
