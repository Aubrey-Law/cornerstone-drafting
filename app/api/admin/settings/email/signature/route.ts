import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { clearFirmSettingsCache, loadFirmSettings } from '@/lib/firmSettings'
import { sanitizeEmailHtml } from '@/lib/email/templateShared'
import { getAdminClient } from '@/lib/supabaseAdmin'

function migrationError(message: string): boolean {
  const value = message.toLowerCase()
  return value.includes('email_signature') || value.includes('schema cache') || value.includes('does not exist')
}

export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const firm = await loadFirmSettings(true)
  return NextResponse.json({
    signature: {
      html: firm.emailSignatureHtml,
      includeByDefault: firm.emailSignatureDefault,
    },
  })
}

export async function PUT(req: Request) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  const body = await req.json().catch(() => null) as {
    html?: unknown
    includeByDefault?: unknown
  } | null
  if (!body || typeof body.html !== 'string' || typeof body.includeByDefault !== 'boolean') {
    return NextResponse.json({ error: 'html and includeByDefault are required' }, { status: 400 })
  }

  const html = sanitizeEmailHtml(body.html).trim()
  const { error } = await getAdminClient()
    .from('firm_settings' as never)
    .update({
      email_signature_html: html || null,
      email_signature_default: body.includeByDefault,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    } as never)
    .eq('id', 1)

  if (error) {
    return NextResponse.json(
      { error: migrationError(error.message) ? 'Apply the email signature migration first.' : error.message },
      { status: migrationError(error.message) ? 503 : 500 },
    )
  }
  clearFirmSettingsCache()
  return NextResponse.json({ signature: { html, includeByDefault: body.includeByDefault } })
}
