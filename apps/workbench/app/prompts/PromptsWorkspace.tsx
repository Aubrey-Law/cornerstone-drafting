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
 */
export function PromptsWorkspace({ prompts, matters }: { prompts: PromptChoice[]; matters: MatterChoice[] }) {
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
            <p className="font-medium">
              {state.findingCount} {state.findingCount === 1 ? 'finding' : 'findings'}, {state.tasksCreated}{' '}
              {state.tasksCreated === 1 ? 'task' : 'tasks'} created.
            </p>
            {state.runId ? <p className="text-xs text-muted-foreground">Run {state.runId} recorded.</p> : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
