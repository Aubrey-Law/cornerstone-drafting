import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { assembleManualEmail } from '@/lib/email/manualAssembly'
import { sanitizeEmailHtml } from '@/lib/email/templateShared'

const UNRESOLVED_RE = /\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g

export async function POST(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  const body = await req.json().catch(() => null) as {
    subject?: unknown
    html?: unknown
    text?: unknown
    includeSignature?: unknown
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const html = typeof body.html === 'string' ? sanitizeEmailHtml(body.html) : ''
  const text = typeof body.text === 'string' ? body.text : ''
  const unresolved = [...new Set(`${subject}\n${html}`.match(UNRESOLVED_RE) ?? [])]
  const assembled = await assembleManualEmail({
    html,
    text,
    includeSignature: body.includeSignature === true,
  })
  return NextResponse.json({
    subject,
    html: assembled.html,
    text: assembled.text,
    signatureIncluded: assembled.signatureIncluded,
    unresolved,
  })
}
