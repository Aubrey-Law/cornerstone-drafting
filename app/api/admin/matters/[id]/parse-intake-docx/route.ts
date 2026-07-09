import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  extractDocxText,
  getDocxFileValidationError,
  getImportTextValidationError,
  parseAndSaveMatterIntakeDraft,
} from '@/lib/intakeImport/leadIntakeImport'

type Params = { params: Promise<{ id: string }> }

function errorStatus(message: string): number {
  if (message === 'Matter not found') return 404
  if (message.startsWith('AI ')) return 502
  if (message.includes('char') || message.includes('empty') || message.includes('unreadable')) return 400
  return 500
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  const docxFile = file instanceof File ? file : null
  const fileError = getDocxFileValidationError(docxFile)
  if (fileError || !docxFile) {
    return NextResponse.json({ error: fileError ?? 'No file provided' }, { status: 400 })
  }

  let text: string
  try {
    text = await extractDocxText(docxFile)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error'
    return NextResponse.json({ error: `Could not read Word document: ${message}` }, { status: 400 })
  }

  const trimmed = text.trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'File appears to be empty or unreadable' }, { status: 400 })
  }

  const textError = getImportTextValidationError(trimmed)
  if (textError) return NextResponse.json({ error: textError }, { status: 400 })

  try {
    const result = await parseAndSaveMatterIntakeDraft({ matterId, text: trimmed })
    return NextResponse.json({ ok: true, intakeId: result.intakeId, data: result.data })
  } catch (e) {
    console.error('matter parse-intake-docx error:', e)
    const message = e instanceof Error ? e.message : 'Failed to parse intake'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
