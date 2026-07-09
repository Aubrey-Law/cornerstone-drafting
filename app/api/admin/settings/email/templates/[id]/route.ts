import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { isEmailCategory, type EmailCategory } from '@/lib/email/categories'
import { isHtmlTemplateBody, sanitizeEmailHtml } from '@/lib/email/templateShared'

type Params = { params: Promise<{ id: string }> }

interface TemplateUpdatePayload {
  name?: unknown
  category?: unknown
  subject?: unknown
  body?: unknown
  isActive?: unknown
  isDefault?: unknown
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined
}

async function clearDefaultForCategory(category: EmailCategory, exceptId: string) {
  await getAdminClient()
    .from('email_templates')
    .update({ is_default: false })
    .eq('category', category)
    .neq('id', exceptId)
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  const body = await req.json().catch(() => null) as TemplateUpdatePayload | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: userId ?? null,
  }

  const name = cleanString(body.name)
  const subject = cleanString(body.subject)
  const templateBody = cleanString(body.body)

  if (name !== undefined) {
    if (!name) return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
    update.name = name
  }
  if (body.category !== undefined) {
    if (!isEmailCategory(body.category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }
    update.category = body.category
  }
  if (subject !== undefined) {
    if (!subject) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
    update.subject = subject
  }
  if (templateBody !== undefined) {
    if (!templateBody) return NextResponse.json({ error: 'Template body is required' }, { status: 400 })
    // Rich-text bodies arrive as HTML; sanitize to the editor allowlist.
    update.body = isHtmlTemplateBody(templateBody) ? sanitizeEmailHtml(templateBody) : templateBody
  }
  if (body.isActive !== undefined) update.is_active = body.isActive === true
  if (body.isDefault !== undefined) update.is_default = body.isDefault === true

  const admin = getAdminClient()

  let categoryForDefault = update.category as EmailCategory | undefined
  if (update.is_default === true && !categoryForDefault) {
    const { data: existing, error: existingError } = await admin
      .from('email_templates')
      .select('category')
      .eq('id', id)
      .maybeSingle()
    if (existingError || !existing) {
      return NextResponse.json({ error: existingError?.message ?? 'Template not found' }, { status: existingError ? 500 : 404 })
    }
    categoryForDefault = existing.category as EmailCategory
  }

  if (update.is_default === true && categoryForDefault) {
    await clearDefaultForCategory(categoryForDefault, id)
  }

  const { data, error } = await admin
    .from('email_templates')
    .update(update)
    .eq('id', id)
    .select('id, name, category, subject, body, is_active, is_default, updated_at, created_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  return NextResponse.json({ template: data })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  const { error } = await getAdminClient()
    .from('email_templates')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
