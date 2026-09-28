import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listPlaybooks, streamReview, type PlaybookSummary } from '../api/client'
import {
  actionsFor,
  applyReviewEvent,
  bulkReplacements,
  commentText,
  EMPTY_REVIEW,
  filterRows,
  isIssue,
  orderFindings,
  RISK_LABEL,
  ruleRows,
  STATUS_LABEL,
  tally,
  type Risk,
  type RuleRow,
  type RuleSort,
  type RuleStatus,
  type ReviewFindingEvent,
  type ReviewRuleInfo,
  type ReviewState,
  type StatusFilter,
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
 * Three screens: a summary (the playbook's pass rate and the issues to work),
 * the full report (every rule with its status, filterable), and one finding
 * with what can be done about it. What the attorney has done to a finding —
 * a comment, a tracked change and its decision — is held here, not in the
 * finding's screen, so it survives moving between them.
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

type ListView = 'summary' | 'report'
type View = { name: ListView } | { name: 'rule'; ruleNumber: string; back: ListView }

/** What has been done to one finding in Word. */
interface Worked {
  commented?: boolean
  /** The tracked change's bookmark, or 'applied' when Word gave none back. */
  bookmark?: string
  resolved?: 'accept' | 'reject'
}

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
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [worked, setWorked] = useState<Record<string, Worked>>({})
  const [view, setView] = useState<View>({ name: 'summary' })
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
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
    setWorked({})
    setBulkNote(null)
    setReview(EMPTY_REVIEW)
    setView({ name: 'summary' })
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

  const markWorked = (ruleNumber: string, change: Worked) =>
    setWorked((current) => ({ ...current, [ruleNumber]: { ...current[ruleNumber], ...change } }))

  const rows = useMemo(() => ruleRows(review), [review])
  const counts = useMemo(() => tally(rows), [rows])
  const ruleByNumber = useMemo(() => new Map(review.rules.map((rule) => [rule.number, rule])), [review.rules])
  const issues = useMemo(
    () => orderFindings(review.findings, review.rules).filter((f) => isIssue(f) && !dismissed.has(f.ruleNumber)),
    [review.findings, review.rules, dismissed],
  )
  const pendingBulk = bulkReplacements(review).filter(({ finding }) => !worked[finding.ruleNumber]?.bookmark)

  /** Every verified suggestion as a tracked change, one after another, so Word sees them in order. */
  const applyAll = async () => {
    setBulkBusy(true)
    setBulkNote(null)
    let applied = 0
    let refused = 0
    try {
      for (const { finding, text } of pendingBulk) {
        const citation = finding.citation!
        const result = await replaceCitationTracked({ blockIndex: citation.blockIndex, quote: citation.quote }, text)
        if (result.ok) {
          applied += 1
          markWorked(finding.ruleNumber, { bookmark: result.bookmark ?? 'applied' })
        } else {
          refused += 1
        }
      }
    } finally {
      setBulkBusy(false)
      setBulkNote(
        `Applied ${applied} ${applied === 1 ? 'suggestion' : 'suggestions'} as tracked changes` +
          (refused > 0 ? `; ${refused} could not be placed and need doing by hand.` : '.'),
      )
    }
  }

  if (loadError) return <p className="p-3 text-fail">{loadError}</p>
  if (!playbooks) return <p className="p-3 text-[color:var(--color-ink-muted)]">Loading playbooks…</p>
  if (playbooks.length === 0) {
    return (
      <p className="p-3 text-[color:var(--color-ink-muted)]">
        No review playbooks are published yet. Build one in Cornerstone under Reviews → “Build a playbook”.
      </p>
    )
  }

  if (view.name === 'rule') {
    const row = rows.find((r) => r.rule.number === view.ruleNumber)
    if (row) {
      return (
        <Screen onBack={() => setView({ name: view.back })} backLabel={view.back === 'report' ? 'Playbook' : 'Review'}>
          <RuleDetail
            row={row}
            playbookTitle={review.playbook?.title ?? 'Review'}
            worked={worked[row.rule.number] ?? {}}
            onWorked={(change) => markWorked(row.rule.number, change)}
            onDismiss={() => {
              setDismissed((current) => new Set(current).add(row.rule.number))
              setView({ name: view.back })
            }}
          />
        </Screen>
      )
    }
  }

  if (view.name === 'report' && review.playbook) {
    return (
      <Report
        review={review}
        rows={rows}
        counts={counts}
        running={running}
        bulkCount={pendingBulk.length}
        bulkBusy={bulkBusy}
        bulkNote={bulkNote}
        onBack={() => setView({ name: 'summary' })}
        onOpen={(ruleNumber) => setView({ name: 'rule', ruleNumber, back: 'report' })}
        onRerun={() => void run()}
        onApplyAll={() => void applyAll()}
      />
    )
  }

  return (
    <div className="space-y-4 p-3">
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
            {review.playbook ? 'Run again' : 'Run review'}
          </button>
        )}
      </div>

      {!matterId && !review.playbook && (
        <p className="text-[11px] text-[color:var(--color-ink-muted)]">
          No matter linked: every rule runs. Link a matter to skip rules its design sheet rules out.
        </p>
      )}

      {error && <p className="text-fail">{error}</p>}

      {review.playbook && (
        <>
          <h1 className="text-lg font-semibold">Review</h1>

          <button
            type="button"
            onClick={() => setView({ name: 'report' })}
            className="block w-full rounded-lg border border-[color:var(--color-line)] p-3 text-left hover:bg-[color:var(--color-surface-sunken)]"
            data-testid="playbook-card"
          >
            <span className="flex items-center gap-2 text-[11px] text-[color:var(--color-ink-muted)]">
              <DocIcon />
              <span className="min-w-0 flex-1 truncate">{review.playbook.title}</span>
              <span className="shrink-0">Full report ›</span>
            </span>
            <span className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Count value={counts.passed} label="passed" tone="pass" />
              <Count value={counts.failed} label="failed" tone="fail" />
              {counts.didNotRun > 0 && <Count value={counts.didNotRun} label="did not run" tone="warn" />}
              {counts.pending > 0 && <Count value={counts.pending} label="checking" tone="muted" />}
            </span>
            <ProgressBar counts={counts} />
          </button>

          <div className="space-y-0.5 text-[11px] text-[color:var(--color-ink-muted)]" data-testid="review-status">
            <MatterNote context={review.matterContext} linked={Boolean(matterId)} />
            <RecordingNote review={review} />
            {review.aborted && <p>Stopped before every rule was checked.</p>}
            {review.error && <p className="text-fail">{review.error}</p>}
          </div>

          <TopIssues
            issues={issues}
            ruleByNumber={ruleByNumber}
            done={review.done}
            anySettled={review.findings.length > 0}
            onOpen={(ruleNumber) => setView({ name: 'rule', ruleNumber, back: 'summary' })}
          />
        </>
      )}
    </div>
  )
}

function TopIssues({
  issues,
  ruleByNumber,
  done,
  anySettled,
  onOpen,
}: {
  issues: ReviewFindingEvent[]
  ruleByNumber: Map<string, ReviewRuleInfo>
  done: boolean
  anySettled: boolean
  onOpen: (ruleNumber: string) => void
}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? issues.filter((f) =>
        `${ruleByNumber.get(f.ruleNumber)?.statement ?? ''} ${f.rationale}`.toLowerCase().includes(needle),
      )
    : issues

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Top issues to review</h2>
        <button
          type="button"
          aria-label="Search issues"
          onClick={() => setSearching((v) => !v)}
          className="text-[color:var(--color-ink-muted)]"
        >
          <SearchIcon />
        </button>
      </div>
      {searching && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search issues"
          aria-label="Search issues"
          className="w-full rounded border border-[color:var(--color-line)] bg-transparent px-2 py-1"
        />
      )}

      {shown.length > 0 ? (
        <ul className="space-y-2">
          {shown.map((finding) => (
            <li key={finding.ruleNumber}>
              <button
                type="button"
                onClick={() => onOpen(finding.ruleNumber)}
                className="block w-full rounded-lg border border-[color:var(--color-line)] p-3 text-left hover:bg-[color:var(--color-surface-sunken)]"
                data-testid="issue-card"
              >
                <span className="flex items-center gap-2 text-[11px] text-[color:var(--color-ink-muted)]">
                  <DocIcon />
                  <span className="flex-1">Playbook rule {finding.ruleNumber}</span>
                  {finding.severity && <RiskPill risk={finding.severity} />}
                </span>
                <span className="mt-1.5 line-clamp-2 block font-medium">
                  {ruleByNumber.get(finding.ruleNumber)?.statement ?? `Rule ${finding.ruleNumber}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[color:var(--color-ink-muted)]">
          {needle
            ? 'No issue matches that search.'
            : done
              ? anySettled
                ? 'No issues found against this playbook.'
                : 'No rule settled, so there is nothing to show.'
              : 'Issues appear here as rules are checked.'}
        </p>
      )}
    </section>
  )
}

function Report({
  review,
  rows,
  counts,
  running,
  bulkCount,
  bulkBusy,
  bulkNote,
  onBack,
  onOpen,
  onRerun,
  onApplyAll,
}: {
  review: ReviewState
  rows: RuleRow[]
  counts: ReturnType<typeof tally>
  running: boolean
  bulkCount: number
  bulkBusy: boolean
  bulkNote: string | null
  onBack: () => void
  onOpen: (ruleNumber: string) => void
  onRerun: () => void
  onApplyAll: () => void
}) {
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<RuleSort>('playbook')
  const [query, setQuery] = useState('')
  const shown = filterRows(rows, { status, query, sort })
  const runId = review.recording?.saved ? review.recording.runId : null

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3 p-3">
        <BackButton onClick={onBack} label="Review" />
        <div>
          <h1 className="text-lg font-semibold">Playbook</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-[color:var(--color-ink-muted)]">
            <DocIcon />
            {review.playbook?.title} · v{review.playbook?.version}
          </p>
        </div>

        <div data-testid="report-summary">
          <p className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold">{counts.percentPassed === null ? '—' : `${counts.percentPassed}%`}</span>
            <span className="text-[11px] text-[color:var(--color-ink-muted)]">rules passed</span>
          </p>
          <ProgressBar counts={counts} />
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            <Legend tone="pass" value={counts.passed} label="Passed" />
            <Legend tone="fail" value={counts.failed} label="Failed" />
            <Legend tone="warn" value={counts.didNotRun} label="Did not run" />
            <Legend tone="muted" value={counts.notApplicable} label="Not applicable" />
            {counts.pending > 0 && <Legend tone="muted" value={counts.pending} label="Checking" />}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="rounded-full border border-[color:var(--color-line)] bg-transparent px-2 py-0.5 text-[11px]"
          >
            <option value="all">All statuses</option>
            {(['failed', 'passed', 'did_not_run', 'not_applicable', 'pending'] as RuleStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Order"
            value={sort}
            onChange={(e) => setSort(e.target.value as RuleSort)}
            className="rounded-full border border-[color:var(--color-line)] bg-transparent px-2 py-0.5 text-[11px]"
          >
            <option value="playbook">Playbook order</option>
            <option value="severity">Failures first</option>
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rules"
            aria-label="Search rules"
            className="min-w-0 flex-1 rounded border border-[color:var(--color-line)] bg-transparent px-2 py-0.5 text-[11px]"
          />
        </div>

        <ul className="space-y-1.5" data-testid="rule-list">
          {shown.map((row) => (
            <li key={row.rule.number}>
              <button
                type="button"
                onClick={() => onOpen(row.rule.number)}
                className="flex w-full items-center gap-2 rounded-lg border border-[color:var(--color-line)] px-3 py-2 text-left hover:bg-[color:var(--color-surface-sunken)]"
              >
                <span className="line-clamp-2 min-w-0 flex-1 font-medium">{row.rule.statement}</span>
                <StatusPill status={row.status} />
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="text-[color:var(--color-ink-muted)]">No rule matches.</li>}
        </ul>
        {bulkNote && <p className="text-[11px] text-[color:var(--color-ink-muted)]">{bulkNote}</p>}
      </div>

      {/* Pinned to the pane's foot, as in the summary's own actions. */}
      <div className="sticky bottom-0 flex items-center justify-around gap-2 border-t border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-3 py-2 text-[12px]">
        <button type="button" onClick={onRerun} disabled={running} className="disabled:opacity-40">
          ↻ Rerun
        </button>
        <button
          type="button"
          onClick={onApplyAll}
          disabled={running || bulkBusy || bulkCount === 0}
          title="Every verified suggestion, as tracked changes. Missing clauses are inserted one at a time from each finding."
          className="disabled:opacity-40"
        >
          ✓ {bulkBusy ? 'Applying…' : `Apply all${bulkCount > 0 ? ` (${bulkCount})` : ''}`}
        </button>
        {runId && (
          <button type="button" onClick={() => openInCornerstone(`/admin/review/${runId}`)}>
            ↗ Open in Cornerstone
          </button>
        )}
      </div>
    </div>
  )
}

function RuleDetail({
  row,
  playbookTitle,
  worked,
  onWorked,
  onDismiss,
}: {
  row: RuleRow
  playbookTitle: string
  worked: Worked
  onWorked: (change: Worked) => void
  onDismiss: () => void
}) {
  const { rule, finding } = row
  return (
    <div className="space-y-2" data-testid="rule-detail">
      <p className="flex items-center gap-2 text-[11px] text-[color:var(--color-ink-muted)]">
        <DocIcon />
        <span className="flex-1">Playbook rule {rule.number}</span>
        {finding?.severity && isIssue(finding) ? <RiskPill risk={finding.severity} /> : <StatusPill status={row.status} />}
      </p>
      <h2 className="font-semibold">{rule.statement}</h2>
      {row.status === 'pending' && <p className="text-[color:var(--color-ink-muted)]">Still being checked.</p>}
      {row.status === 'did_not_run' && (
        <p className="text-warn">This rule did not run ({row.failureReason}). Check it by hand; it is not a pass.</p>
      )}
      {finding && (
        <FindingBody finding={finding} rule={rule} playbookTitle={playbookTitle} worked={worked} onWorked={onWorked} onDismiss={onDismiss} />
      )}
    </div>
  )
}

const OUTCOME_LABEL: Record<string, string> = {
  deviation: 'Does not meet the rule',
  absent: 'Missing from the document',
  compliant: 'Meets the rule',
  not_applicable: 'Does not apply to this matter',
}

function FindingBody({
  finding,
  rule,
  playbookTitle,
  worked,
  onWorked,
  onDismiss,
}: {
  finding: ReviewFindingEvent
  rule: ReviewRuleInfo
  playbookTitle: string
  worked: Worked
  onWorked: (change: Worked) => void
  onDismiss: () => void
}) {
  const actions = actionsFor(finding, rule)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const target = finding.citation ? { blockIndex: finding.citation.blockIndex, quote: finding.citation.quote } : null
  const { commented, bookmark, resolved } = worked

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
    if (result.ok) onWorked({ resolved: decision })
    else setNote(result.reason === 'no-revisions' ? 'Already resolved in Word.' : 'Use Word’s Review tab for this one.')
  }

  const button = 'rounded border border-[color:var(--color-line)] px-2 py-0.5'

  return (
    <div className="space-y-2" data-testid="finding-card">
      <p className="text-[11px] font-medium text-[color:var(--color-ink-muted)]">{OUTCOME_LABEL[finding.outcome] ?? finding.outcome}</p>
      {finding.rationale && <p>{finding.rationale}</p>}

      {finding.citation && (
        <blockquote className="border-l-2 border-[color:var(--color-line)] pl-2 font-serif text-[12px] text-[color:var(--color-ink-muted)]">
          {finding.citation.quote}
        </blockquote>
      )}
      {!finding.citation && finding.attemptedQuote && (
        <p className="text-[11px] text-[color:var(--color-ink-muted)]">
          The passage this finding quoted could not be found in the document, so it cannot be marked up. Check it by hand.
        </p>
      )}
      {actions.replace && (
        <div className="rounded bg-pass/10 p-2 font-serif text-[12px]">
          <p className="mb-0.5 font-sans text-[11px] font-medium text-pass">Suggested language</p>
          {actions.replace}
        </div>
      )}
      {actions.insert && !actions.replace && (
        <div className="rounded bg-pass/10 p-2 font-serif text-[12px]">
          <p className="mb-0.5 font-sans text-[11px] font-medium text-pass">Firm language</p>
          {actions.insert}
        </div>
      )}

      {note && <p className="text-[11px] text-fail">{note}</p>}
      {bookmark && !resolved && <p className="text-[11px] text-[color:var(--color-ink-muted)]">Applied as a tracked change.</p>}
      {resolved && <p className="text-[11px] text-[color:var(--color-ink-muted)]">{resolved === 'accept' ? 'Accepted.' : 'Rejected.'}</p>}

      <div className="flex flex-wrap gap-2 text-[11px]">
        {actions.reveal && target && (
          <button type="button" disabled={busy} onClick={() => void act(() => revealCitation(target))} className="underline">
            Show in document
          </button>
        )}
        {actions.comment && target && !commented && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => commentOnCitation(target, commentText(finding, rule, playbookTitle)), () => onWorked({ commented: true }))}
            className={button}
          >
            Add comment
          </button>
        )}
        {commented && <span className="text-[color:var(--color-ink-muted)]">Comment added.</span>}
        {actions.replace && target && !bookmark && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => replaceCitationTracked(target, actions.replace!), (b) => onWorked({ bookmark: b ?? 'applied' }))}
            className={button}
          >
            Apply suggestion
          </button>
        )}
        {actions.insert && !bookmark && (
          <button
            type="button"
            disabled={busy}
            title="Inserted as a new paragraph after the one your cursor is in"
            onClick={() => void act(() => insertAfterCursorTracked(actions.insert!), (b) => onWorked({ bookmark: b ?? 'applied' }))}
            className={button}
          >
            Insert after cursor
          </button>
        )}
        {bookmark && bookmark !== 'applied' && !resolved && (
          <>
            <button type="button" onClick={() => void decide('accept')} className={button}>
              Accept
            </button>
            <button type="button" onClick={() => void decide('reject')} className={button}>
              Reject
            </button>
            <button type="button" onClick={() => void revealTrackedEdit(bookmark)} className="underline">
              Show change
            </button>
          </>
        )}
        {isIssue(finding) && (
          <button type="button" onClick={onDismiss} className="ml-auto text-[color:var(--color-ink-muted)] underline">
            Dismiss
          </button>
        )}
      </div>
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

/**
 * The saved review in Cornerstone. The pane is served by Cornerstone in
 * production, so its own origin is Cornerstone's. Office's browser window
 * where it exists, since some Word hosts ignore `window.open`.
 */
function openInCornerstone(path: string) {
  const url = new URL(path, window.location.origin).toString()
  const ui = typeof Office !== 'undefined' ? (Office.context?.ui as { openBrowserWindow?: (u: string) => void } | undefined) : undefined
  if (ui?.openBrowserWindow) ui.openBrowserWindow(url)
  else window.open(url, '_blank', 'noopener')
}

export function RecordingNote({ review }: { review: ReviewState }) {
  const recording = review.recording
  if (!recording) return null
  if (!recording.saved) return <p data-testid="review-recording">Not saved to review history: {recording.reason}</p>
  if (review.recordingProblem) {
    return (
      <p className="text-fail" data-testid="review-recording">
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
      return <p className="text-fail">Design sheet could not be read ({context.reason}), so every rule ran.</p>
    default:
      return null
  }
}

type Tone = 'pass' | 'fail' | 'warn' | 'muted'

const TONE_TEXT: Record<Tone, string> = {
  pass: 'text-pass',
  fail: 'text-fail',
  warn: 'text-warn',
  muted: 'text-[color:var(--color-ink-muted)]',
}
const TONE_DOT: Record<Tone, string> = {
  pass: 'bg-pass',
  fail: 'bg-fail',
  warn: 'bg-warn',
  muted: 'bg-[color:var(--color-line)]',
}

function Count({ value, label, tone }: { value: number; label: string; tone: Tone }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className={`inline-block h-2 w-2 rounded-sm ${TONE_DOT[tone]}`} aria-hidden />
      <span className="text-lg font-semibold">{value}</span>
      <span className="text-[11px] text-[color:var(--color-ink-muted)]">{label}</span>
    </span>
  )
}

function Legend({ value, label, tone }: { value: number; label: string; tone: Tone }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-sm ${TONE_DOT[tone]}`} aria-hidden />
      <span className="font-semibold">{value}</span>
      <span className="text-[color:var(--color-ink-muted)]">{label}</span>
    </span>
  )
}

/** Passed, failed, did not run and still checking, left to right. Not-applicable rules are left out of the bar. */
function ProgressBar({ counts }: { counts: ReturnType<typeof tally> }) {
  const segments: Array<[number, string]> = [
    [counts.passed, 'bg-pass'],
    [counts.failed, 'bg-fail'],
    [counts.didNotRun, 'bg-warn'],
    [counts.pending, 'bg-[color:var(--color-line)]'],
  ]
  const total = segments.reduce((sum, [n]) => sum + n, 0)
  return (
    <span className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-sunken)]" aria-hidden>
      {total > 0 && segments.map(([n, cls], i) => (n > 0 ? <span key={i} className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null))}
    </span>
  )
}

const RISK_TONE: Record<Risk, Tone> = { blocker: 'fail', high: 'fail', medium: 'warn', low: 'muted' }

function RiskPill({ risk }: { risk: Risk }) {
  const tone = RISK_TONE[risk]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 text-[11px] font-medium ${TONE_TEXT[tone]}`}>
      <span aria-hidden>▲</span>
      {RISK_LABEL[risk]}
    </span>
  )
}

const STATUS_TONE: Record<RuleStatus, Tone> = {
  passed: 'pass',
  failed: 'fail',
  did_not_run: 'warn',
  not_applicable: 'muted',
  pending: 'muted',
}
const STATUS_MARK: Record<RuleStatus, string> = { passed: '✓', failed: '✕', did_not_run: '!', not_applicable: '–', pending: '…' }

function StatusPill({ status }: { status: RuleStatus }) {
  const tone = STATUS_TONE[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--color-line)] bg-[color:var(--color-surface-sunken)] px-2 py-0.5 text-[11px] ${TONE_TEXT[tone]}`}
    >
      <span aria-hidden>{STATUS_MARK[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  )
}

function Screen({ children, onBack, backLabel }: { children: ReactNode; onBack: () => void; backLabel: string }) {
  return (
    <div className="space-y-3 p-3">
      <BackButton onClick={onBack} label={backLabel} />
      {children}
    </div>
  )
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className="text-[12px] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]">
      ← {label}
    </button>
  )
}

function DocIcon() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0">
      <path d="M4 1.5h5.5L12.5 4.5V14.5H4z" />
      <path d="M6 7.5h4.5M6 10h4.5" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  )
}
