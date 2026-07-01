import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  getDesignSheetDocxValidationError,
  getDesignSheetImportTextValidationError,
} from '@/lib/designSheetImport/shared'
import {
  extractDesignSheetDocxText,
  parseDesignSheetImportText,
} from '@/lib/designSheetImport/server'

type Params = { params: Promise<{ id: string }> }

function errorStatus(message: string): number {
  if (message === 'No design-sheet fields were found') return 400
  if (message === 'text required' || message.includes('char')) return 400
  if (message.startsWith('AI ')) return 502
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
  const fileError = getDesignSheetDocxValidationError(docxFile)
  if (fileError || !docxFile) {
    return NextResponse.json({ error: fileError ?? 'No file provided' }, { status: 400 })
  }

  let text: string
  try {
    text = await extractDesignSheetDocxText(docxFile)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return NextResponse.json({ error: `Could not read Word document: ${message}` }, { status: 400 })
  }

  const trimmed = text.trim()
  if (!trimmed) {
    return NextResponse.json({ error: 'File appears to be empty or unreadable' }, { status: 400 })
  }

  const textError = getDesignSheetImportTextValidationError(trimmed)
  if (textError) return NextResponse.json({ error: textError }, { status: 400 })

  try {
    const result = await parseDesignSheetImportText({ matterId, text: trimmed })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('design-sheet import-docx error:', error)
    const message = error instanceof Error ? error.message : 'Failed to parse design sheet'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
