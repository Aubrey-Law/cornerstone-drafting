'use client'

import Link from 'next/link'
import { useActionState, useCallback, useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { runAudit, type RunAuditState } from '@/app/admin/field-audits/actions'
import type { FieldAuditRunChoice, PromptChoice } from '@/app/admin/field-audits/FieldAuditWorkspace'
import { TONE_NOTICE } from '@/lib/ui/tone'

interface FieldAuditsView {
  prompts: PromptChoice[]
  hasDesignSheet: boolean
  runs: FieldAuditRunChoice[]
  unresolvedBlocker: { runId: string; ruleNumbers: string[] } | null
}

const INITIAL_STATE: RunAuditState = { ok: null, message: null, runId: null }

/**
 * Field audits of this matter's design sheet, on its Reviews tab beside the
 * playbook reviews of its documents: run one against a published audit
 * prompt, and see the runs and any blocker nobody has decided.
 *
 * A blocker is advisory — it never stops the matter changing stage — and
 * accepting, rejecting or deferring it on the run page clears it here.
 */
export function MatterFieldAuditsCard({ matterId }: { matterId: string }) {
  const [view, setView] = useState<FieldAuditsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/matters/${encodeURIComponent(matterId)}/field-audits`)
      const body = (await response.json().catch(() => ({}))) as Partial<FieldAuditsView> & { error?: string }
      if (!response.ok || !body.prompts || !body.runs) {
        throw new Error(body.error ?? `Could not load field audits (${response.status})`)
      }
      setView({
        prompts: body.prompts,
        hasDesignSheet: Boolean(body.hasDesignSheet),
        runs: body.runs,
        unresolvedBlocker: body.unresolvedBlocker ?? null,
      })
      setSlug(current => current || body.prompts?.[0]?.slug || '')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load field audits')
    }
  }, [matterId])

  useEffect(() => {
    setView(null)
    void load()
  }, [load])

  const [state, formAction, pending] = useActionState(async (previous: RunAuditState, form: FormData) => {
    const result = await runAudit(previous, form)
    if (result.ok) void load()
    return result
  }, INITIAL_STATE)

  const canRun = Boolean(view && view.hasDesignSheet && view.prompts.length > 0)

  return (
    <Card className="gap-0 py-0" data-testid="matter-field-audits">
      <CardHeader className="border-b py-3 [.border-b]:pb-3">
        <CardTitle className="text-sm">Field audits</CardTitle>
        <CardDescription className="text-xs">
          Checks this matter&apos;s design sheet against a published audit prompt, and opens tasks for what it finds.
        </CardDescription>
        {canRun && view ? (
          <CardAction>
            <form action={formAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="matterId" value={matterId} />
              {view.prompts.length > 1 ? (
                <NativeSelect
                  aria-label="Prompt"
                  name="slug"
                  value={slug}
                  onChange={event => setSlug(event.target.value)}
                  className="h-8 w-auto max-w-64"
                >
                  {view.prompts.map(prompt => (
                    <option key={prompt.slug} value={prompt.slug}>
                      {prompt.title} ({prompt.checkCount} {prompt.checkCount === 1 ? 'check' : 'checks'})
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <input type="hidden" name="slug" value={slug} />
              )}
              <Button type="submit" variant="outline" size="sm" disabled={pending}>
                {pending ? 'Queuing…' : 'Run field audit'}
              </Button>
            </form>
          </CardAction>
        ) : null}
      </CardHeader>

      {view?.unresolvedBlocker ? (
        <div className={`m-4 mb-0 ${TONE_NOTICE.warning}`} data-testid="matter-unresolved-blocker">
          <span className="font-medium">A blocker nobody has decided: </span>
          {view.unresolvedBlocker.ruleNumbers.map(number => `check ${number}`).join(', ')}.{' '}
          <Link href={`/admin/field-audits/${view.unresolvedBlocker.runId}`} className="font-medium text-primary hover:underline">
            Decide it on the run
          </Link>
          <span className="block text-xs text-muted-foreground">
            Advisory only: it does not stop the matter changing stage.
          </span>
        </div>
      ) : null}

      {state.message ? (
        <p role="alert" className={`m-4 mb-0 ${TONE_NOTICE.danger}`}>
          {state.message}
        </p>
      ) : null}
      {state.ok && state.runId ? (
        <p className={`m-4 mb-0 ${TONE_NOTICE.success}`} data-testid="field-audit-queued">
          Queued; it runs within the minute.{' '}
          <Link href={`/admin/field-audits/${state.runId}`} className="font-medium text-primary hover:underline">
            Follow its progress
          </Link>
        </p>
      ) : null}

      {error ? (
        <p className="px-4 py-3 text-sm text-destructive">{error}</p>
      ) : view === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Loading field audits…</p>
      ) : !view.hasDesignSheet ? (
        <EmptyState
          icon={ClipboardCheck}
          className="py-8"
          title="Nothing to audit yet"
          description="This matter has no design sheet yet, so there is nothing for a field audit to check."
        />
      ) : view.prompts.length === 0 && view.runs.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          className="py-8"
          title="No field audits available"
          description="No field-audit prompt is published yet."
        />
      ) : view.runs.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          className="py-8"
          title="No field audits yet"
          description="No field audits have run on this matter yet."
        />
      ) : (
        <ul className="divide-y divide-border" data-testid="matter-field-audit-runs">
          {view.runs.map(run => (
            <li key={run.runId}>
              <Link
                href={`/admin/field-audits/${run.runId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors hover:bg-accent"
              >
                <span className="font-medium">{run.promptTitle ?? 'Field audit'}</span>
                <span className="text-xs text-muted-foreground">
                  {run.findingCount} findings
                  {run.failedCount > 0 ? ` · ${run.failedCount} checks failed` : ''}
                  {run.status === 'partial' ? ' · partial' : ''}
                  {run.status === 'queued' || run.status === 'running' ? ' · in progress' : ''}
                  {run.finishedAt ? ` · ${run.finishedAt.slice(0, 10)}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
