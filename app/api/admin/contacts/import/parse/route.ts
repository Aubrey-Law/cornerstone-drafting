import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  extractFiduciaryImportFileText,
  getFiduciaryImportFileValidationError,
  getFiduciaryImportTextValidationError,
  parseFiduciaryContactsFromText,
} from '@/lib/adminFiduciaryContactImport'

function errorStatus(message: string): number {
  if (message.includes('required') || message.includes('too ') || message.includes('supported')) return 400
  if (message.includes('ANTHROPIC_API_KEY')) return 503
  if (message.startsWith('AI ')) return 502
  return 500
}

export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const contentType = req.headers.get('content-type') ?? ''
  let text = ''
  let preferAi = true

  if (contentType.includes('multipart/form-data')) {
    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
    }

    const file = formData.get('file')
    const upload = file instanceof File ? file : null
    const fileError = getFiduciaryImportFileValidationError(upload)
    if (fileError || !upload) {
      return NextResponse.json({ error: fileError ?? 'No file provided' }, { status: 400 })
    }

    try {
      text = await extractFiduciaryImportFileText(upload)
      preferAi = upload.name.toLowerCase().endsWith('.docx')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      return NextResponse.json({ error: `Could not read document: ${message}` }, { status: 400 })
    }
  } else {
    let body: { text?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    text = body.text ?? ''
    preferAi = true
  }

  const trimmed = text.trim()
  const validationError = getFiduciaryImportTextValidationError(trimmed)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  try {
    const contacts = await parseFiduciaryContactsFromText({ text: trimmed, userId, preferAi })
    if (contacts.length === 0) return NextResponse.json({ error: 'No contacts found' }, { status: 422 })
    return NextResponse.json({ ok: true, contacts })
  } catch (error) {
    console.error('admin contacts import parse error:', error)
    const message = error instanceof Error ? error.message : 'Failed to parse contacts'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
