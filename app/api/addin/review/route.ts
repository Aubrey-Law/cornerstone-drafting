import { requireAdmin } from '@/lib/apiAuth'
import { callAnthropic } from '@/lib/anthropic'
import { resolveFirmModel } from '@/lib/firmModels'
import { consumeRateLimit } from '@/lib/rateLimit'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadMatterFacts, loadReviewPlaybook } from '@/lib/addinReview/playbooks'
import { runRulesStreaming } from '@/lib/addinReview/runRules'
import { buildPlainTextLayer } from '@aubrey-law/citations/textLayer/plain'
import type { ModelCaller } from '@aubrey-law/citations/review/model'
import type { MatterFacts } from '@aubrey-law/citations/review/conditions'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** A review is many model calls; this is looser than chat per request, tighter per window. */
const RATE_LIMIT = { bucket: 'addin_review', limit: 12, windowSeconds: 600 }

/** Far above any estate instrument, well below anything that would strain the function. */
const MAX_PARAGRAPHS = 20_000
const MAX_TOTAL_CHARS = 1_000_000

interface ReviewBody {
  /** `Word.Paragraph.text` for every paragraph, in order — including empty ones. */
  paragraphs?: unknown
  playbookSlug?: unknown
  matterId?: unknown
}

function sse(data: Record<string, unknown>) {
  return `data: ${JSON.stringify(data)}\n\n`
}

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

/**
 * Runs one review playbook against the document open in Word and streams each
 * rule's finding as it settles.
 *
 * The pane sends Word's own paragraph text rather than the file, so every
 * citation's block index is a paragraph index Word can go straight back to —
 * see `buildPlainTextLayer`. Quotes are verified against exactly that text.
 *
 * Not recorded: nothing here writes a run or findings. Recording needs a
 * filed document version to anchor citations to, which is the workbench's
 * path; this is the attorney checking a draft they are editing.
 *
 * With a linked matter, the design sheet's facts are applied, so rules whose
 * conditions the matter rules out are reported as not applicable without a
 * model call.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId!

  const limit = await consumeRateLimit(RATE_LIMIT, userId)
  if (!limit.ok) {
    return json(429, { error: 'Too many reviews in a short time. Try again shortly.' }, {
      'Retry-After': String(limit.retryAfterSeconds),
    })
  }

  const body = (await req.json().catch(() => null)) as ReviewBody | null
  if (!body) return json(400, { error: 'Invalid JSON body' })

  const paragraphs = body.paragraphs
  if (!Array.isArray(paragraphs) || !paragraphs.every((p): p is string => typeof p === 'string')) {
    return json(400, { error: 'Expected the document as a list of paragraphs.' })
  }
  if (paragraphs.length > MAX_PARAGRAPHS || paragraphs.reduce((n, p) => n + p.length, 0) > MAX_TOTAL_CHARS) {
    return json(413, { error: 'This document is too long to review from Word.' })
  }
  const slug = typeof body.playbookSlug === 'string' ? body.playbookSlug.trim() : ''
  if (!slug) return json(400, { error: 'Choose a playbook to run.' })
  const matterId = typeof body.matterId === 'string' && body.matterId ? body.matterId : null

  const layer = buildPlainTextLayer(paragraphs)
  if (layer.status === 'no_text') return json(422, { error: 'The document has no text to review.' })

  const admin = getAdminClient()
  const playbook = await loadReviewPlaybook(admin, slug).catch((error: unknown) => {
    console.error('[addin/review] playbook', error)
    return null
  })
  if (!playbook) return json(404, { error: `No published review playbook named "${slug}".` })

  /*
   * Facts failing to load never fails the review — it only means every rule
   * runs, which is the safe direction — but the pane is told, so an attorney
   * who linked a matter is not left believing conditions were applied.
   */
  let matterFacts: MatterFacts | null = null
  let matterContext: { state: 'none' } | { state: 'applied' } | { state: 'no_sheet' } | { state: 'unavailable'; reason: string } =
    { state: 'none' }
  if (matterId) {
    try {
      matterFacts = await loadMatterFacts(admin, matterId)
      matterContext = matterFacts ? { state: 'applied' } : { state: 'no_sheet' }
    } catch (error) {
      matterContext = { state: 'unavailable', reason: error instanceof Error ? error.message : 'Design sheet unavailable' }
    }
  }

  const callModel: ModelCaller = (request, context) => callAnthropic(request, context)
  const model = await resolveFirmModel('drafting')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(sse(data)))
        } catch {
          // Client hung up; the run stops starting new rules via the signal.
        }
      }
      try {
        send({
          start: true,
          playbook: { slug: playbook.slug, title: playbook.title, version: playbook.version },
          rules: playbook.rules.map(rule => ({
            number: rule.number,
            risk: rule.risk,
            statement: rule.statement,
            preferredLanguage: rule.preferredLanguage ?? null,
          })),
          matterContext,
        })
        const result = await runRulesStreaming(
          layer,
          { slug: playbook.slug, title: playbook.title, version: playbook.version, rules: playbook.rules },
          {
            callModel,
            model,
            matterFacts,
            matterId,
            userId,
            signal: req.signal,
            onFinding: finding => send({ finding }),
            onFailure: failure => send({ failure }),
          },
        )
        send({ done: true, completed: result.completed, aborted: result.aborted })
      } catch (error) {
        console.error('[addin/review]', error)
        send({ error: error instanceof Error ? error.message : 'The review failed.' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
