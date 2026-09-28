'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ListChecks } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { TONE_NOTICE } from '@/lib/ui/tone'
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
  matterId: string
  matterTitle: string
  runId: string
  ruleNumbers: string[]
}

// Kept here rather than imported from actions.ts: a "use server" file may
// only export async functions, so the seed value for `useActionState` lives
// on this side instead.
const INITIAL_STATE: RunAuditState = { ok: null, message: null, runId: null }

/**
 * The field-audit workspace: pick a field-audit prompt and a matter, queue it,
 * and see recent runs. Ported from the workbench's `/prompts`.
 *
 * `unresolvedBlockers` is advisory only: a blocker never stops a matter from
 * changing stage. It lists the latest run per matter and prompt that still has
 * an open blocker; deciding the finding on its run page clears it.
 */
export function FieldAuditWorkspace({
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
    <div className="space-y-4">
      <PageHeader
        title="Field audits"
        description="Checks a matter's design sheet against a published audit prompt and opens tasks for what it finds. Each matter's audits are also on its Reviews tab."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/review">
              <ArrowLeft className="size-4" aria-hidden />
              Reviews
            </Link>
          </Button>
        }
      />

      {unresolvedBlockers.length > 0 ? (
        <section className={`space-y-2 ${TONE_NOTICE.warning}`} data-testid="unresolved-blockers">
          <h2 className="text-sm font-semibold">Blockers nobody has dispositioned yet</h2>
          {/* Advisory only, and said plainly: a list of blockers with no
              explanation invites the reader to assume a transition was
              prevented. It was not. */}
          <p className="text-xs text-muted-foreground">
            An unresolved blocker does not block anything. Accept, reject or defer it on the run page to clear it from
            this list.
          </p>
          <ul className="divide-y divide-amber-border border-t border-amber-border">
            {unresolvedBlockers.map((blocker) => (
              <li key={blocker.matterId}>
                <Link
                  href={`/admin/field-audits/${blocker.runId}`}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm hover:underline"
                >
                  <span className="font-medium">{blocker.matterTitle}</span>
                  <span className="text-xs text-muted-foreground">
                    {blocker.ruleNumbers.map((ruleNumber) => `Check ${ruleNumber}`).join(', ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">Run an audit</CardTitle>
          <CardDescription className="text-xs">
            Queued runs are worked within the minute; the run page refreshes until it settles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {matters.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="no-matters">
              No matter has a design sheet yet, so there is nothing for a field audit to run against.
            </p>
          ) : prompts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="no-prompts">
              No field-audit prompt is published yet.
            </p>
          ) : null}

          {canRun ? (
            <form action={formAction} className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="Prompt"
                name="slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                className="w-auto"
              >
                {prompts.map((prompt) => (
                  <option key={prompt.slug} value={prompt.slug}>
                    {prompt.title} ({prompt.checkCount} {prompt.checkCount === 1 ? 'check' : 'checks'})
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label="Matter"
                name="matterId"
                value={matterId}
                onChange={(event) => setMatterId(event.target.value)}
                className="w-auto max-w-64"
              >
                {matters.map((matter) => (
                  <option key={matter.matterId} value={matter.matterId}>
                    {matter.title}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Queuing…' : 'Run audit'}
              </Button>
            </form>
          ) : null}

          {state.message ? (
            <p role="alert" className={TONE_NOTICE.danger}>
              {state.message}
            </p>
          ) : null}

          {state.ok ? (
            <div className={TONE_NOTICE.success} data-testid="run-result">
              {/* Queued, not finished: the run queue works it within the
                  minute. The run's own page keeps refreshing until it settles. */}
              {state.runId ? (
                <p>
                  Queued.{' '}
                  <Link href={`/admin/field-audits/${state.runId}`} className="font-medium text-primary hover:underline">
                    Follow its progress
                  </Link>
                  .
                </p>
              ) : (
                <p className="font-medium">Queued.</p>
              )}
            </div>
          ) : null}

          {matters.length > 0 && prompts.length > 0 ? (
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Published field-audit prompts</h3>
              {/* Named with its check count up front: an attorney should know
                  what is about to be applied before choosing it, not just what
                  came back afterward. */}
              <ul className="divide-y divide-border rounded-lg border border-border" data-testid="prompt-list">
                {prompts.map((prompt) => (
                  <li key={prompt.slug} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                    <span className="font-medium">{prompt.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {prompt.checkCount} {prompt.checkCount === 1 ? 'check' : 'checks'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="gap-0 py-0" data-testid={runs.length > 0 ? 'run-history' : undefined}>
        <CardHeader className="block space-y-1 border-b py-3 [.border-b]:pb-3">
          <CardTitle className="text-sm">Recent audit runs</CardTitle>
        </CardHeader>
        {runs.length > 0 ? (
          <ul className="divide-y divide-border">
            {runs.map((run) => (
              <li key={run.runId}>
                <Link
                  href={`/admin/field-audits/${run.runId}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-accent"
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
        ) : (
          <EmptyState icon={ListChecks} title="No audits run yet" className="py-8" />
        )}
      </Card>
    </div>
  )
}
