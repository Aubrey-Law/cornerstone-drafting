import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { requireStaff } from '@/lib/auth/requireStaff'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'
import { loadReviewableByMatter, resolveReviewableDocument } from '@/lib/review/matterDocuments'
import { saveFindings, saveTextLayer } from '@/lib/review/persist'
import { buildLayer, extractorFor, reviewLayer } from '@/lib/review/run'
import { readReviewUpload } from '@/lib/review/upload'
import { readObject } from '@/lib/storage/r2'
import { getAdminClient } from '@/lib/supabase/admin'
import { openRun, recordStep, finaliseRun } from '@/lib/runs/record'
import type { RunStep } from '@/lib/runs/steps'

/**
 * Runs one review playbook against one uploaded document.
 *
 * Two ways in. A `documentVersionId` names a document already filed on a
 * matter, which is the normal case now that every draft reviewed here is the
 * firm's own: it gives the review a real `document_versions.id` to anchor
 * citations to, which an ad-hoc upload cannot. An uploaded file still works,
 * for a draft not yet filed.
 *
 * The client sends an id, never a storage key. A key from the browser would be
 * an arbitrary read against the bucket holding every client's documents.
 *
 * Nothing is stored yet. The run and its findings are the next piece; this is
 * what makes them anchorable.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const form = await request.formData()
  const documentVersionId = String(form.get('documentVersionId') ?? '').trim()

  let bytes: Buffer
  let filename: string
  let anchor: { documentVersionId: string; documentId: string; matterId: string } | null = null

  if (documentVersionId) {
    const resolved = resolveReviewableDocument(
      await loadReviewableByMatter(getAdminClient()),
      documentVersionId,
    )
    if (!resolved) {
      return NextResponse.json(
        { error: 'That document is not one of the current, citable documents on a hired matter.' },
        { status: 404 },
      )
    }
    try {
      bytes = await readObject(resolved.source.key)
    } catch (error) {
      return NextResponse.json(
        { error: `Could not read ${resolved.name} from storage: ${error instanceof Error ? error.message : 'unknown error'}` },
        { status: 502 },
      )
    }
    filename = resolved.name
    anchor = {
      documentVersionId: resolved.versionId,
      documentId: resolved.documentId,
      matterId: resolved.matterId,
    }
  } else {
    const upload = await readReviewUpload(form)
    if (!upload.ok) return NextResponse.json({ error: upload.message }, { status: 400 })
    bytes = upload.bytes
    filename = upload.filename
  }

  let callModel
  try {
    callModel = anthropicModelCaller()
  } catch (error) {
    if (error instanceof AnthropicKeyMissingError) {
      // 503 rather than 500: the app is fine, this feature is not configured.
      return NextResponse.json({ error: error.message }, { status: 503 })
    }
    throw error
  }

  // Loaded here rather than through `loadReviewPlaybook`, which returns only
  // the shape the runner needs: the persisted run below needs the version's
  // id too, to record exactly which wording produced these findings.
  const prompt = await loadPublishedPrompt(getAdminClient(), REVIEW_PLAYBOOK_SLUG)
  if (!prompt || prompt.body.kind !== 'review') {
    // 503, matching the missing-Anthropic-key case above: the app is fine,
    // this feature has nothing published to run.
    return NextResponse.json(
      { error: `No published review prompt named "${REVIEW_PLAYBOOK_SLUG}".` },
      { status: 503 },
    )
  }
  const playbook = {
    slug: prompt.slug,
    title: prompt.title,
    version: prompt.versionNumber,
    rules: prompt.body.rules,
  }

  try {
    const kind = extractorFor(filename)
    if (!kind) {
      throw new Error(`${filename} is not a PDF or a DOCX. Those are the formats a citation can be anchored in.`)
    }
    const layer = await buildLayer(bytes, kind)

    const admin = getAdminClient()

    // Recorded only for a filed document, and only for a document with an
    // actual text layer — a scan throws from `reviewLayer` below before any
    // rule ever runs, and a run opened ahead of that would be a `running`
    // row this request could never finish. Everything else about a failure
    // to store is reported rather than swallowed: a review the attorney
    // believes was saved and was not is worse than one they know was not.
    let runId: string | null = null
    let textLayerId: string | null = null
    let saveError: string | null = null

    if (anchor && layer.status !== 'no_text') {
      try {
        const savedLayer = await saveTextLayer(admin, {
          documentVersionId: anchor.documentVersionId,
          layer,
        })
        if (savedLayer.ok) {
          textLayerId = savedLayer.layerId
          runId = await openRun(admin, {
            matterId: anchor.matterId,
            kind: 'review',
            promptVersionId: prompt.versionId,
            model: null,
            unitTotal: playbook.rules.length,
            userId: auth.user.id,
            resolvedInputs: null,
            documentVersionId: anchor.documentVersionId,
            textLayerId,
          })
        } else {
          saveError = savedLayer.message
        }
      } catch (error) {
        // A storage hiccup opening the run must not stop the review itself
        // from running and being shown — only from being saved.
        runId = null
        saveError = error instanceof Error ? error.message : 'Could not open the run.'
      }
    }

    // Filled in as each rule settles, in the order it settled — which is
    // playbook order, since runPrompt runs one unit at a time. This is what
    // `finaliseRun` reads the run's status and counts from.
    const steps: RunStep[] = []
    let sequence = 0

    const result = await reviewLayer(layer, playbook, {
      callModel,
      userId: auth.user.id,
      onUnitSettled: runId
        ? async (unitId, outcome) => {
            const stepSequence = sequence
            sequence += 1
            await recordStep(admin, runId!, unitId, stepSequence, outcome, 1)
            steps.push({
              unitId,
              status: outcome.ok ? 'succeeded' : 'failed',
              attempts: 1,
              sequence: stepSequence,
            })
          }
        : undefined,
    })

    if (runId) {
      const saved = await saveFindings(admin, {
        runId,
        documentVersionId: anchor!.documentVersionId,
        textLayerId: textLayerId!,
        result,
      })
      if (!saved.ok) saveError = saved.message
      await finaliseRun(admin, runId, steps)
    }

    return NextResponse.json({
      filename,
      anchor,
      runId,
      saveError,
      playbook: { slug: playbook.slug, title: playbook.title, version: playbook.version },
      layer,
      result,
    })
  } catch (error) {
    // A scan, or an unreadable file. Both are the caller's to fix, and both
    // deserve the real reason rather than a generic failure.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The review could not be run.' },
      { status: 422 },
    )
  }
}
