import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getDesignSheetImportTextValidationError } from '@/lib/designSheetImport/shared'
import { parseDesignSheetImportText } from '@/lib/designSheetImport/server'

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

  let body: { text?: unknown } | null
  try {
    const parsed = await req.json()
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as { text?: unknown }
      : null
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const validationError = getDesignSheetImportTextValidationError(text)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  try {
    const result = await parseDesignSheetImportText({ matterId, text })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('design-sheet import-text error:', error)
    const message = error instanceof Error ? error.message : 'Failed to parse design sheet'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
