import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import {
  EMAIL_CATEGORY_META,
  isEmailCategory,
  type EmailCategory,
} from '@/lib/email/categories'
import { isHtmlTemplateBody, sanitizeEmailHtml } from '@/lib/email/templateShared'

interface TemplatePayload {
  name?: unknown
  category?: unknown
  subject?: unknown
  body?: unknown
  isActive?: unknown
  isDefault?: unknown
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toTemplate(row: Record<string, unknown>) {
  const category = row.category as EmailCategory
  return {
    id: row.id,
    name: row.name,
    category,
    categoryLabel: EMAIL_CATEGORY_META[category]?.label ?? category,
    subject: row.subject,
    body: row.body,
    isActive: row.is_active,
    isDefault: row.is_default,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  }
}

function parseTemplatePayload(body: TemplatePayload) {
  const name = cleanString(body.name)
  const category = body.category
  const subject = cleanString(body.subject)
  // Rich-text bodies arrive as HTML; sanitize to the editor allowlist before
  // storing. Plain-text bodies pass through untouched.
  const rawBody = cleanString(body.body)
  const templateBody = isHtmlTemplateBody(rawBody) ? sanitizeEmailHtml(rawBody) : rawBody

  if (!name) return { error: 'Template name is required' as const }
  if (!isEmailCategory(category)) return { error: 'Email category is required' as const }
  if (!subject) return { error: 'Subject is required' as const }
  if (!templateBody) return { error: 'Template body is required' as const }

  return {
    data: {
      name,
      category,
      subject,
      body: templateBody,
      is_active: body.isActive !== false,
      is_default: body.isDefault === true,
    },
  }
}

async function clearDefaultForCategory(category: EmailCategory, exceptId?: string) {
  let query = getAdminClient()
    .from('email_templates')
    .update({ is_default: false })
    .eq('category', category)

  if (exceptId) query = query.neq('id', exceptId)
  await query
}

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const category = req.nextUrl.searchParams.get('category')
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'

  if (category && !isEmailCategory(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  let query = getAdminClient()
    .from('email_templates')
    .select('id, name, category, subject, body, is_active, is_default, updated_at, created_at')
    .order('category', { ascending: true })
    .order('updated_at', { ascending: false })

  if (category) query = query.eq('category', category)
  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ templates: (data ?? []).map(row => toTemplate(row as Record<string, unknown>)) })
}

export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as TemplatePayload | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = parseTemplatePayload(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  if (parsed.data.is_default) await clearDefaultForCategory(parsed.data.category)

  const { data, error } = await getAdminClient()
    .from('email_templates')
    .insert({
      ...parsed.data,
      created_by: userId ?? null,
      updated_by: userId ?? null,
    })
    .select('id, name, category, subject, body, is_active, is_default, updated_at, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: toTemplate(data as Record<string, unknown>) }, { status: 201 })
}
