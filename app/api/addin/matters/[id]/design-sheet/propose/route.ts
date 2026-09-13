import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { parseDesignSheetImportText, loadCurrentDesignSheet } from '@/lib/designSheetImport/server'
import {
  MAX_DESIGN_SHEET_IMPORT_TEXT_LENGTH,
  getDesignSheetImportTextValidationError,
} from '@/lib/designSheetImport/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

/** The extraction is a model call; match the chat lane rather than leaving it open. */
const RATE_LIMIT = { bucket: 'addin_design_sheet_propose', limit: 30, windowSeconds: 600 }

/**
 * What the open document says the design sheet should say.
 *
 * Reuses the same extraction as the web import dialog — `parseDesignSheetImportText`
 * builds the proposal, compares it against the stored sheet, and marks each row
 * `replacement` when it would overwrite a value that is already there. Nothing
 * here re-reads or re-interprets the design sheet, so the pane and the dialog
 * cannot disagree about what a document is proposing.
 *
 * Read-only. It proposes; `../apply` writes, and only what the attorney ticked.
 *
 * The `sheetId` and `updatedAt` returned are the compare-and-swap token: the pane
 * hands them back on apply, so a sheet edited in the web app while the attorney
 * was reviewing is refused rather than overwritten.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId!

  const limit = await consumeRateLimit(RATE_LIMIT, userId)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id: matterId } = await params
  const body = await req.json().catch(() => null) as { documentText?: unknown } | null

  const text = typeof body?.documentText === 'string'
    ? body.documentText.trim().slice(0, MAX_DESIGN_SHEET_IMPORT_TEXT_LENGTH)
    : ''
  const validationError = getDesignSheetImportTextValidationError(text)
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  try {
    // Read before extracting, so the token belongs to the sheet the preview's
    // "current" column was actually built from.
    const currentSheet = await loadCurrentDesignSheet(matterId)
    const result = await parseDesignSheetImportText({ matterId, text, userId })

    return NextResponse.json(
      {
        ...result,
        sheetId: currentSheet?.id ?? null,
        updatedAt: currentSheet?.updated_at ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not read the document'
    // "Nothing found" is an ordinary outcome for a document that is all prose,
    // not a server fault — the pane says so rather than showing a failure.
    const status = message === 'No design-sheet fields were found' ? 422
      : message.startsWith('AI ') ? 502
      : 500
    if (status === 500) console.error('[addin/design-sheet/propose]', error)
    return NextResponse.json({ error: message }, { status })
  }
}
