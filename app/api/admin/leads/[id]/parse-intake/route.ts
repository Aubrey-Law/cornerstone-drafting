import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  getImportTextValidationError,
  parseAndSaveLeadIntakeDraft,
} from '@/lib/intakeImport/leadIntakeImport'

type Params = { params: Promise<{ id: string }> }

function errorStatus(message: string): number {
  if (message === 'Lead not found') return 404
  if (message === 'text required' || message.includes('char')) return 400
  if (message.startsWith('AI ')) return 502
  return 500
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: leadId } = await params
  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = (body.text ?? '').trim()
  const validationError = getImportTextValidationError(text)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  try {
    const result = await parseAndSaveLeadIntakeDraft({ leadId, text })
    return NextResponse.json({ ok: true, intakeId: result.intakeId, data: result.data })
  } catch (e) {
    console.error('lead parse-intake error:', e)
    const message = e instanceof Error ? e.message : 'Failed to parse intake'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
