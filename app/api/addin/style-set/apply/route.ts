import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { applyStyleSetToDocxBuffer } from '@/lib/styleSets/applyToDocx'
import { isNoOpStyleSet } from '@/lib/styleSets/schema'
import { resolveStyleSet } from '@/lib/styleSets/data'

export const maxDuration = 60

const RATE_LIMIT = { bucket: 'addin_style_pass', limit: 20, windowSeconds: 600 }

/**
 * Vercel caps a serverless request body at 4.5 MB. Rejecting above ~3.5 MB of
 * base64 turns a blown limit into a message the attorney can act on instead of
 * an opaque platform error.
 */
const MAX_BASE64_CHARS = 3_500_000

interface ApplyBody {
  styleSetId?: string | null
  fileBase64?: string
}

/**
 * Apply the firm style set to a document the add-in sends up, and send the
 * bytes back.
 *
 * The pane replaces the open document with the result via
 * `Document.insertFileFromBase64`, which carries headers, footers, watermarks,
 * and section properties across — so page setup survives, which no Office.js
 * style API can do on Word for the web.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const limit = await consumeRateLimit(RATE_LIMIT, auth.userId!)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many formatting runs. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const body = (await req.json().catch(() => null)) as ApplyBody | null
  if (!body?.fileBase64) {
    return NextResponse.json({ error: 'Expected fileBase64' }, { status: 400 })
  }
  if (body.fileBase64.length > MAX_BASE64_CHARS) {
    return NextResponse.json(
      { error: 'This document is too large to format through the add-in.' },
      { status: 413 },
    )
  }

  try {
    const settings = await resolveStyleSet(body.styleSetId ?? null)

    // A style set that overrides nothing is a guaranteed no-op. Say so rather
    // than making the attorney wait for a round trip that replaces their
    // document with an identical copy.
    if (isNoOpStyleSet(settings)) {
      return NextResponse.json({ noOp: true, changedParts: [] })
    }

    const { buffer, changedParts } = applyStyleSetToDocxBuffer(
      Buffer.from(body.fileBase64, 'base64'),
      settings,
    )

    return NextResponse.json({
      noOp: changedParts.length === 0,
      changedParts,
      fileBase64: buffer.toString('base64'),
    })
  } catch (err) {
    console.error('[addin/style-set/apply]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not apply the style set' },
      { status: 500 },
    )
  }
}
