import { useEffect, useMemo, useRef, useState } from 'react'
import { listPlaybooks, streamReview, type PlaybookSummary } from '../api/client'
import {
  actionsFor,
  applyReviewEvent,
  commentText,
  EMPTY_REVIEW,
  isIssue,
  orderFindings,
  settledCount,
  type ReviewFindingEvent,
  type ReviewRuleInfo,
  type ReviewState,
} from '../review/model'
import {
  commentOnCitation,
  insertAfterCursorTracked,
  readParagraphTexts,
  replaceCitationTracked,
  revealCitation,
} from '../../word/reviewActions'
import { resolveTrackedEdit, revealTrackedEdit } from '../../word/trackedChanges'
import { currentDocumentName, MAX_UPLOAD_BASE64_CHARS, readDocumentBytes } from '../../word/readDocumentBytes'

/**
 * Run a firm playbook against the open document and work its findings in place.
 *
 * Each rule is checked separately on the server and every quote is verified
 * against this document's text before it becomes a citation, so anything the
 * pane marks up — a comment, a tracked replacement — is anchored to text that
 * is really there. Findings stream in as rules settle, issues first.
 *
 * With a matter linked, the matter's design sheet decides which conditional
 * rules apply; the pane says whether that happened rather than assuming it.
 *
 * Saved to review history: the pane sends a copy of the document with the
 * review, and the server keeps it as the review's snapshot — what Word had
 * open at that moment, saved or not — so the findings, their citations and the
 * attorney's decisions on them can be come back to. A document too large to
 * send, or one Word will not hand over, is still reviewed; the pane says it is
 * not saved.
 */
export default function ReviewPanel({
  matterId,
  linkedDocumentId = null,
}: {
  matterId: string | null
  /** The Cornerstone document this file was opened from, when one is linked. */
  linkedDocumentId?: string | null
}) {
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[] | null>(null)
  const [slug, setSlug] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewState>(EMPTY_REVIEW)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassed, setShowPassed] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let cancelled = false
    listPlaybooks()
      .then(({ playbooks: list }) => {
        if (cancelled) return
        setPlaybooks(list)
        setSlug((current) => current || list[0]?.slug || '')
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load playbooks.')
      })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
  }, [])

  const run = async () => {
    if (!slug) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setError(null)
    setDismissed(new Set())
    setReview(EMPTY_REVIEW)
    try {
      const paragraphs = await readParagraphTexts()
      const fileBase64 = await readSnapshot(paragraphs)
      await streamReview({
        paragraphs,
        playbookSlug: slug,
        matterId,
        fileBase64,
        documentName: currentDocumentName(),
        documentId: linkedDocumentId,
        signal: controller.signal,
        onEvent: (event) => setReview((state) => applyReviewEvent(state, event)),
      })
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'The review failed.')
    } finally {
      // Stopped by the attorney: no done frame will arrive, so say so here —
      // unless a newer review has already replaced this one.
      if (controller.signal.aborted && abortRef.current === controller) {
        setReview((state) => (state.done ? state : { ...state, done: true, aborted: true }))
      }
      setRunning(false)
    }
  }

  const stop = () => abortRef.current?.abort()

  const ruleByNumber = useMemo(() => new Map(review.rules.map((rule) => [rule.number, rule])), [review.rules])
  const ordered = useMemo(() => orderFindings(review.findings, review.rules), [review.findings, review.rules])
  const issues = ordered.filter((f) => isIssue(f) && !dismissed.has(f.ruleNumber))
  const passed = ordered.filter((f) => !isIssue(f))
  const settled = settledCount(review)

  if (loadError) return <p className="p-3 text-red-600">{loadError}</p>
  if (!playbooks) return <p className="p-3 text-[color:var(--color-ink-muted)]">Loading playbooks…</p>
  if (playbooks.length === 0) {
    return (
      <p className="p-3 text-[color:var(--color-ink-muted)]">
        No review playbooks are published yet. Build one in Cornerstone under Reviews → “Build a playbook”.
      </p>
    )
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Playbook"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={running}
          className="min-w-0 flex-1 rounded border border-[color:var(--color-line)] bg-transparent px-2 py-1"
        >
          {playbooks.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.title} ({p.ruleCount} rules)
            </option>
          ))}
        </select>
        {running ? (
          <button type="button" onClick={stop} className="rounded border border-[color:var(--color-line)] px-3 py-1">
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            className="rounded bg-[color:var(--color-accent)] px-3 py-1 font-medium text-white disabled:opacity-40"
          >
            Run review
          </button>
        )}
      </div>

      {!matterId && !review.playbook && (
        <p className="text-[11px] text-[color:var(--color-ink-muted)]">
          No matter linked: every rule runs. Link a matter to skip rules its design sheet rules out.
        </p>
      )}

      {error && <p className="text-red-600">{error}</p>}

      {review.playbook && (
        <div className="space-y-1 text-[11px] text-[color:var(--color-ink-muted)]" data-testid="review-status">
          <p>
            {review.done ? (review.aborted ? 'Stopped' : 'Done') : 'Checking'}: {settled} of {review.rules.length} rules
            · {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
            {review.failures.length > 0 ? ` · ${review.failures.length} did not run` : ''}
          </p>
          <MatterNote context={review.matterContext} linked={Boolean(matterId)} />
          <RecordingNote review={review} />
          {review.error && <p className="text-red-600">{review.error}</p>}
        </div>
      )}

      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((finding) => (
            <li key={finding.ruleNumber}>
              <FindingCard
                finding={finding}
                rule={ruleByNumber.get(finding.ruleNumber)}
                playbookTitle={review.playbook?.title ?? 'Review'}
                onDismiss={() => setDismissed((current) => new Set(current).add(finding.ruleNumber))}
              />
            </li>
          ))}
        </ul>
      )}

      {review.done && issues.length === 0 && review.findings.length > 0 && (
        <p>No issues found against this playbook.</p>
      )}

      {review.failures.length > 0 && (
        <div className="text-[11px]">
          <p className="font-medium">Rules that did not run</p>
          {/* Named, never folded into the count: a rule that never ran is not a rule that found nothing. */}
          <ul className="mt-1 space-y-0.5 text-[color:var(--color-ink-muted)]">
            {review.failures.map((f) => (
              <li key={f.ruleNumber}>
                Rule {f.ruleNumber} — {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {passed.length > 0 && (
        <div className="text-[11px]">
          <button type="button" onClick={() => setShowPassed((v) => !v)} className="underline">
            {showPassed ? 'Hide' : 'Show'} {passed.length} passed or not applicable
          </button>
          {showPassed && (
            <ul className="mt-1 space-y-1 text-[color:var(--color-ink-muted)]">
              {passed.map((f) => (
                <li key={f.ruleNumber}>
                  <span className="font-medium">
                    Rule {f.ruleNumber} · {f.outcome === 'compliant' ? 'meets it' : 'not applicable'}
                  </span>{' '}
                  {f.rationale}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The document's bytes to keep with the review, or null when they cannot be
 * sent: Word refused, or the file plus its text would exceed what the server
 * accepts. Never throws — an unsaved review is still a review.
 */
async function readSnapshot(paragraphs: string[]): Promise<string | null> {
  try {
    const fileBase64 = await readDocumentBytes()
    const textLength = paragraphs.reduce((total, paragraph) => total + paragraph.length, 0)
    return fileBase64.length + textLength > MAX_UPLOAD_BASE64_CHARS ? null : fileBase64
  } catch {
    return null
  }
}

export function RecordingNote({ review }: { review: ReviewState }) {
  const recording = review.recording
  if (!recording) return null
  if (!recording.saved) return <p data-testid="review-recording">Not saved to review history: {recording.reason}</p>
  if (review.recordingProblem) {
    return (
      <p className="text-red-600" data-testid="review-recording">
        Saving stopped part-way ({review.recordingProblem}). The rules not saved will be finished in the background.
      </p>
    )
  }
  if (!review.done) return <p data-testid="review-recording">Saving to review history as it runs.</p>
  if (review.aborted) {
    return <p data-testid="review-recording">Saved to review history. The rules not yet checked will finish in the background.</p>
  }
  return <p data-testid="review-recording">Saved to review history.</p>
}

function MatterNote({ context, linked }: { context: ReviewState['matterContext']; linked: boolean }) {
  if (!linked) return <p>No matter linked: conditional rules all ran.</p>
  switch (context.state) {
    case 'applied':
      return <p>Design sheet applied: rules it rules out are marked not applicable.</p>
    case 'no_sheet':
      return <p>The linked matter has no design sheet yet, so every rule ran.</p>
    case 'unavailable':
      return <p className="text-red-600">Design sheet could not be read ({context.reason}), so every rule ran.</p>
    default:
      return null
  }
}

const OUTCOME_LABEL: Record<string, string> = {
  deviation: 'Does not meet',
  absent: 'Missing',
}

function FindingCard({
  finding,
  rule,
  playbookTitle,
  onDismiss,
}: {
  finding: ReviewFindingEvent
  rule: ReviewRuleInfo | undefined
  playbookTitle: string
  onDismiss: () => void
}) {
  const actions = actionsFor(finding, rule)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [commented, setCommented] = useState(false)
  const [bookmark, setBookmark] = useState<string | null>(null)
  const [resolved, setResolved] = useState<'accept' | 'reject' | null>(null)
  const target = finding.citation ? { blockIndex: finding.citation.blockIndex, quote: finding.citation.quote } : null

  const act = async (work: () => Promise<{ ok: boolean; reason?: string; bookmark?: string }>, done?: (b?: string) => void) => {
    setBusy(true)
    setNote(null)
    try {
      const result = await work()
      if (result.ok) done?.(result.bookmark)
      else setNote(result.reason ?? 'Word could not do that.')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (decision: 'accept' | 'reject') => {
    if (!bookmark) return
    const result = await resolveTrackedEdit(bookmark, decision)
    if (result.ok) setResolved(decision)
    else setNote(result.reason === 'no-revisions' ? 'Already resolved in Word.' : 'Use Word’s Review tab for this one.')
  }

  const severityClass =
    finding.severity === 'blocker' || finding.severity === 'high' ? 'text-red-700' : 'text-[color:var(--color-ink-muted)]'

  return (
    <div className="rounded border border-[color:var(--color-line)] p-2" data-testid="finding-card">
      <p className="text-[11px]">
        <span className={`font-medium uppercase ${severityClass}`}>{finding.severity ?? ''}</span>{' '}
        <span className="text-[color:var(--color-ink-muted)]">
          Rule {finding.ruleNumber} · {OUTCOME_LABEL[finding.outcome] ?? finding.outcome}
        </span>
      </p>
      {rule && <p className="mt-0.5 font-medium">{rule.statement}</p>}
      {finding.rationale && <p className="mt-1">{finding.rationale}</p>}

      {finding.citation && (
        <blockquote className="mt-1 border-l-2 border-[color:var(--color-line)] pl-2 font-serif text-[11px] text-[color:var(--color-ink-muted)]">
          {finding.citation.quote}
        </blockquote>
      )}
      {!finding.citation && finding.attemptedQuote && (
        <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)]">
          The passage this finding quoted could not be found in the document, so it cannot be marked up. Check it by hand.
        </p>
      )}
      {actions.replace && <p className="mt-1 font-serif text-[11px] text-green-700">Suggested: {actions.replace}</p>}
      {actions.insert && !actions.replace && (
        <p className="mt-1 font-serif text-[11px] text-green-700">Firm language: {actions.insert}</p>
      )}

      {note && <p className="mt-1 text-[11px] text-red-600">{note}</p>}
      {bookmark && !resolved && <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)]">Applied as a tracked change.</p>}
      {resolved && <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)]">{resolved === 'accept' ? 'Accepted.' : 'Rejected.'}</p>}

      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {actions.reveal && target && (
          <button type="button" disabled={busy} onClick={() => void act(() => revealCitation(target))} className="underline">
            Show
          </button>
        )}
        {actions.comment && target && !commented && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void act(() => commentOnCitation(target, commentText(finding, rule, playbookTitle)), () => setCommented(true))
            }
            className="rounded border border-[color:var(--color-line)] px-2 py-0.5"
          >
            Add comment
          </button>
        )}
        {commented && <span className="text-[color:var(--color-ink-muted)]">Comment added.</span>}
        {actions.replace && target && !bookmark && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => replaceCitationTracked(target, actions.replace!), (b) => setBookmark(b ?? 'applied'))}
            className="rounded border border-[color:var(--color-line)] px-2 py-0.5"
          >
            Apply suggestion
          </button>
        )}
        {actions.insert && !bookmark && (
          <button
            type="button"
            disabled={busy}
            title="Inserted as a new paragraph after the one your cursor is in"
            onClick={() => void act(() => insertAfterCursorTracked(actions.insert!), (b) => setBookmark(b ?? 'applied'))}
            className="rounded border border-[color:var(--color-line)] px-2 py-0.5"
          >
            Insert after cursor
          </button>
        )}
        {bookmark && bookmark !== 'applied' && !resolved && (
          <>
            <button type="button" onClick={() => void decide('accept')} className="rounded border border-[color:var(--color-line)] px-2 py-0.5">
              Accept
            </button>
            <button type="button" onClick={() => void decide('reject')} className="rounded border border-[color:var(--color-line)] px-2 py-0.5">
              Reject
            </button>
            <button type="button" onClick={() => void revealTrackedEdit(bookmark)} className="underline">
              Show change
            </button>
          </>
        )}
        <button type="button" onClick={onDismiss} className="ml-auto text-[color:var(--color-ink-muted)] underline">
          Dismiss
        </button>
      </div>
    </div>
  )
}
