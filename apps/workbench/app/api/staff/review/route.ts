import { NextResponse } from 'next/server'
import { AnthropicKeyMissingError, anthropicModelCaller } from '@/lib/anthropic'
import { requireStaff } from '@/lib/auth/requireStaff'
import { loadPublishedPrompt } from '@/lib/prompts/repository'
import { REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'
import { loadReviewableByMatter, resolveReviewableDocument } from '@/lib/review/matterDocuments'
import { loadMatterFacts } from '@/lib/review/matterFacts'
import { saveTextLayer } from '@/lib/review/persist'
import { buildLayer, extractorFor, reviewLayer } from '@/lib/review/run'
import { readReviewUpload } from '@/lib/review/upload'
import { storeReviewUpload } from '@/lib/review/uploads'
import { readObject } from '@/lib/storage/r2'
import { getAdminClient } from '@/lib/supabase/admin'
import { openRun, openSteps } from '@/lib/runs/record'
import { pokeTick } from '@/lib/runs/enqueue'

/**
 * Starts one review playbook against one uploaded document.
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
 * A filed document's review is queued, not run here: once its text layer is
 * saved and the run is opened, `openSteps` writes one `pending` step per
 * rule and `pokeTick` nudges the tick route, and this request returns without
 * calling the model at all — see `apps/workbench/app/api/cron/tick/route.ts`,
 * which now does that work.
 *
 * An uploaded file — a document not filed on any matter, such as a plan
 * another attorney drafted — is now kept (`lib/review/uploads.ts`) and its
 * review queued and recorded the same way, anchored to the upload instead of
 * a document version. Only when keeping it fails does the playbook run inline
 * and the result come back unrecorded, with the reason in `saveError`.
 */
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const form = await request.formData()
  const documentVersionId = String(form.get('documentVersionId') ?? '').trim()
  // Which playbook to run; the firm trust playbook when none is named. Only a
  // published review prompt is accepted — checked below, before any model call.
  const playbookSlug = String(form.get('playbookSlug') ?? '').trim() || REVIEW_PLAYBOOK_SLUG

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
  const prompt = await loadPublishedPrompt(getAdminClient(), playbookSlug)
  if (!prompt || prompt.body.kind !== 'review') {
    // 503, matching the missing-Anthropic-key case above: the app is fine,
    // this feature has nothing published to run.
    return NextResponse.json(
      { error: `No published review prompt named "${playbookSlug}".` },
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

    // Recorded only for a document with an actual text layer — a scan throws
    // from `reviewLayer` below, in the unrecorded fallback path, before any
    // rule ever runs, and a run opened ahead of that would sit `queued`
    // forever with nothing for a tick to work. Everything else about a failure
    // to store is reported rather than swallowed: a review the attorney
    // believes was saved and was not is worse than one they know was not.
    let runId: string | null = null
    let textLayerId: string | null = null
    let saveError: string | null = null
    let reviewUploadId: string | null = null

    if (!anchor && layer.status !== 'no_text') {
      /*
       * An upload with no matter: kept (`review_uploads`, 20261227090000) so
       * its review is recorded like a filed document's — findings, citations
       * and dispositions all anchored to it — rather than shown once and lost.
       * It belongs to no matter, so no design sheet applies and every rule
       * runs. Any failure here, including this code reaching production
       * before its migration, falls back to the inline review below and says
       * why.
       */
      try {
        const stored = await storeReviewUpload(admin, {
          bytes,
          filename,
          kind,
          label: String(form.get('label') ?? ''),
          userId: auth.user.id,
        })
        if (!stored.ok) {
          saveError = stored.message
        } else {
          reviewUploadId = stored.reviewUploadId
          const savedLayer = await saveTextLayer(admin, { reviewUploadId, layer })
          if (!savedLayer.ok) {
            saveError = savedLayer.message
          } else {
            textLayerId = savedLayer.layerId
            runId = await openRun(admin, {
              matterId: null,
              kind: 'review',
              promptVersionId: prompt.versionId,
              model: null,
              unitTotal: playbook.rules.length,
              userId: auth.user.id,
              resolvedInputs: null,
              documentVersionId: null,
              reviewUploadId,
              textLayerId,
            })
          }
        }
      } catch (error) {
        runId = null
        saveError = error instanceof Error ? error.message : 'Could not record the upload.'
      }
    }

    if (anchor && layer.status !== 'no_text') {
      try {
        const savedLayer = await saveTextLayer(admin, {
          documentVersionId: anchor.documentVersionId,
          layer,
        })
        if (savedLayer.ok) {
          textLayerId = savedLayer.layerId
          // Pinned with the run, so rule conditions are tested against the
          // sheet as it stood when the review opened — including on retry.
          const matterFacts = await loadMatterFacts(admin, anchor.matterId)
          runId = await openRun(admin, {
            matterId: anchor.matterId,
            kind: 'review',
            promptVersionId: prompt.versionId,
            model: null,
            unitTotal: playbook.rules.length,
            userId: auth.user.id,
            resolvedInputs: matterFacts ? { matterFacts: { ...matterFacts } } : null,
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

    if (runId) {
      // Enqueue instead of running: one `pending` step per rule, in the
      // playbook's own order, then a nudge so the tick claims it now rather
      // than on the next cron. The model is never called from this request —
      // see `apps/workbench/app/api/cron/tick/route.ts`, which now does that
      // work and saves what it finds.
      await openSteps(
        admin,
        runId,
        playbook.rules.map((rule) => rule.number),
      )
      await pokeTick()

      return NextResponse.json({
        filename,
        anchor,
        reviewUploadId,
        runId,
        saveError,
        playbook: { slug: playbook.slug, title: playbook.title, version: playbook.version },
        layer,
        queued: true,
      })
    }

    // Nothing to enqueue — an ad-hoc upload with no filed version to anchor
    // to, or a storage hiccup that kept this one from being saved (`workflow_runs`
    // requires both `document_version_id` and `text_layer_id` for a
    // `review`-kind row, so neither case can become a queued run). Run the
    // playbook inline instead, so the attorney still sees a result; it is
    // simply not recorded.
    const result = await reviewLayer(layer, playbook, { callModel, userId: auth.user.id })

    return NextResponse.json({
      filename,
      anchor,
      runId: null,
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
