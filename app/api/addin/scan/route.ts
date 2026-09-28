import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { consumeRateLimit } from '@/lib/rateLimit'
import { runScan, type ScanKind } from '@/lib/addinScan/scan'
import { buildPlainTextLayer } from '@aubrey-law/citations/textLayer/plain'
import type { ModelCaller } from '@aubrey-law/citations/review/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** A scan is one call (issues) or a handful (proofread); tighter than chat, looser than a playbook. */
const RATE_LIMIT = { bucket: 'addin_scan', limit: 20, windowSeconds: 600 }

/** The same bounds as the playbook review, which reads the same paragraphs. */
const MAX_PARAGRAPHS = 20_000
const MAX_TOTAL_CHARS = 1_000_000

const KINDS = new Set<ScanKind>(['issues', 'proofread'])

function sse(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/**
 * Issue spotting or proofreading over the document open in Word, streamed a
 * section at a time. See `lib/addinScan/scan.ts`.
 *
 * Takes Word's own paragraph text, as the playbook review does, so each
 * item's paragraph index is one Word can go straight back to. Not recorded to
 * review history: these passes have no playbook version to pin a run to.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId!

  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    return json(503, { error: 'ANTHROPIC_API_KEY is not set, so the document cannot be checked.' })
  }

  const limit = await consumeRateLimit(RATE_LIMIT, userId)
  if (!limit.ok) {
    return json(429, { error: 'Too many checks in a short time. Try again shortly.' }, {
      'Retry-After': String(limit.retryAfterSeconds),
    })
  }

  const body = (await req.json().catch(() => null)) as { kind?: unknown; paragraphs?: unknown; matterId?: unknown } | null
  if (!body) return json(400, { error: 'Invalid JSON body' })

  const kind = body.kind as ScanKind
  if (!KINDS.has(kind)) return json(400, { error: 'Unknown kind of check.' })
  const paragraphs = body.paragraphs
  if (!Array.isArray(paragraphs) || !paragraphs.every((p): p is string => typeof p === 'string')) {
    return json(400, { error: 'Expected the document as a list of paragraphs.' })
  }
  if (paragraphs.length > MAX_PARAGRAPHS || paragraphs.reduce((n, p) => n + p.length, 0) > MAX_TOTAL_CHARS) {
    return json(413, { error: 'This document is too long to check from Word.' })
  }
  const matterId = typeof body.matterId === 'string' && body.matterId ? body.matterId : null

  const layer = buildPlainTextLayer(paragraphs)
  if (layer.status === 'no_text') return json(422, { error: 'The document has no text to check.' })

  const callModel: ModelCaller = (request, context) => callAnthropic(request, context)
  const model = await resolveFirmModel('drafting')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(sse(data)))
        } catch {
          // Client hung up; the scan stops starting new sections via the signal.
        }
      }
      try {
        send({ start: true, kind })
        const result = await runScan(layer, kind, {
          callModel,
          model,
          matterId,
          userId,
          signal: req.signal,
          onItems: items => send({ items }),
          onFailure: failure => send({ failure }),
        })
        send({ done: true, ...result })
      } catch (error) {
        console.error('[addin/scan]', error)
        send({ error: error instanceof Error ? error.message : 'The check failed.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
