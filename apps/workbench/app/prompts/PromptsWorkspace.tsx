'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Button } from '@aubrey-law/ui/button'
import { runAudit, type RunAuditState } from './actions'

export interface PromptChoice {
  slug: string
  title: string
  checkCount: number
}

export interface MatterChoice {
  matterId: string
  title: string
}

export interface FieldAuditRunChoice {
  runId: string
  matterTitle: string
  promptTitle: string | null
  status: string
  findingCount: number
  failedCount: number
  finishedAt: string | null
}

export interface UnresolvedBlockerChoice {
  findingId: string
  runId: string
  matterId: string
  matterTitle: string
  ruleNumber: string
}

// Kept here rather than imported from actions.ts: a "use server" file may
// only export async functions, so the seed value for `useActionState` lives
// on this side instead.
const INITIAL_STATE: RunAuditState = {
  ok: null,
  message: null,
  runId: null,
  findingCount: null,
  tasksCreated: null,
}

/**
 * The `/prompts` workspace: pick a field-audit prompt and a matter, run it,
 * and see what came back. Follows `app/review/ReviewWorkspace.tsx`'s shape —
 * a picker in the header, the "what is about to happen" summary before
 * anything has run, and the result after it has.
 *
 * `unresolvedBlockers` is a knowingly-wrong-place-for-now advisory (see
 * `docs/superpowers/specs/2026-09-06-stage-triggered-runs-design.md`): stage
 * transitions happen in the old app's matter screens, not here, so this
 * surfaces a blocker to someone who has already moved the matter. Phases 6
 * and 10 bring matters into the workbench, and the advisory belongs beside
 * the stage control then — until this page has one, `/prompts` is where it
 * lives, and it never blocks anything, only tells.
 */
export function PromptsWorkspace({
  prompts,
  matters,
  runs = [],
  unresolvedBlockers = [],
}: {
  prompts: PromptChoice[]
  matters: MatterChoice[]
  runs?: FieldAuditRunChoice[]
  unresolvedBlockers?: UnresolvedBlockerChoice[]
}) {
  const [slug, setSlug] = useState(prompts[0]?.slug ?? '')
  const [matterId, setMatterId] = useState(matters[0]?.matterId ?? '')
  const [state, formAction, pending] = useActionState(runAudit, INITIAL_STATE)

  const canRun = prompts.length > 0 && matters.length > 0

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <Link href="/" className="text-xs text-muted-foreground underline underline-offset-4">
            Workbench
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Run a prompt</h1>
        </div>
        {canRun ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Prompt"
              name="slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {prompts.map((prompt) => (
                <option key={prompt.slug} value={prompt.slug}>
                  {prompt.title} ({prompt.checkCount} {prompt.checkCount === 1 ? 'check' : 'checks'})
                </option>
              ))}
            </select>
            <select
              aria-label="Matter"
              name="matterId"
              value={matterId}
              onChange={(event) => setMatterId(event.target.value)}
              className="h-9 max-w-64 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              {matters.map((matter) => (
                <option key={matter.matterId} value={matter.matterId}>
                  {matter.title}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending}>
              {pending ? 'Running…' : 'Run audit'}
            </Button>
          </form>
        ) : null}
      </header>

      {unresolvedBlockers.length > 0 ? (
        <section
          className="mx-6 mt-4 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          data-testid="unresolved-blockers"
        >
          <h2 className="text-sm font-semibold">Blockers nobody has dispositioned yet</h2>
          {/* Advisory only, and said plainly: a list of blockers with no
              explanation invites the reader to assume a transition was
              prevented. It was not — stage moves happen in the old app's
              matter screens, this page only surfaces what was found there. */}
          <p className="text-xs text-muted-foreground">
            An unresolved blocker does not block anything. Disposition it on the run page to clear it from this list.
          </p>
          <ul className="divide-y divide-border border-y border-border">
            {unresolvedBlockers.map((blocker) => (
              <li key={blocker.findingId}>
                <Link
                  href={`/prompts/${blocker.runId}`}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{blocker.matterTitle}</span>
                  <span className="text-xs text-muted-foreground">Check {blocker.ruleNumber}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.message ? (
        <p role="alert" className="mx-6 mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          {state.message}
        </p>
      ) : null}

      <section className="mx-auto w-full max-w-2xl space-y-4 px-6 py-10">
        {matters.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
            data-testid="no-matters"
          >
            No matter has a design sheet yet, so there is nothing for a field audit to run against.
          </p>
        ) : prompts.length === 0 ? (
          <p
            className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground"
            data-testid="no-prompts"
          >
            No field-audit prompt is published yet.
          </p>
        ) : (
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Published field-audit prompts</h2>
            {/* Named with its check count up front: an attorney should know
                what is about to be applied before choosing it, not just what
                came back afterward. */}
            <ul className="divide-y divide-border border-y border-border" data-testid="prompt-list">
              {prompts.map((prompt) => (
                <li key={prompt.slug} className="flex items-baseline justify-between gap-3 py-3 text-sm">
                  <span className="font-medium">{prompt.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {prompt.checkCount} {prompt.checkCount === 1 ? 'check' : 'checks'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {state.ok ? (
          <div className="rounded-md border border-border p-3 text-sm" data-testid="run-result">
            {/* The audit is queued, not finished — `runAudit` no longer calls
                the model itself, so there is no finding count or task count
                to report yet (see app/prompts/actions.ts). Pointing at the
                run's own page, which keeps refreshing until it settles, beats
                showing counts that are still null. */}
            {state.runId ? (
              <p>
                Queued.{' '}
                <Link href={`/prompts/${state.runId}`} className="underline underline-offset-4">
                  Follow its progress
                </Link>
                .
              </p>
            ) : (
              <p className="font-medium">Queued.</p>
            )}
          </div>
        ) : null}

        {runs.length > 0 ? (
          <div className="space-y-2" data-testid="run-history">
            <h2 className="text-sm font-semibold">Recent audit runs</h2>
            <ul className="divide-y divide-border border-y border-border">
              {runs.map((run) => (
                <li key={run.runId}>
                  <Link
                    href={`/prompts/${run.runId}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{run.promptTitle ?? 'Field audit'}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{run.matterTitle}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {run.findingCount} findings
                      {run.failedCount > 0 ? ` · ${run.failedCount} checks failed` : ''}
                      {run.status === 'partial' ? ' · partial' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
