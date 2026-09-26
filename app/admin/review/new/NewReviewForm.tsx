'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export interface PlaybookChoice {
  slug: string
  title: string
  rules: Array<{ number: string; risk: string; statement: string; appliesWhen: string[] }>
}

export interface MatterChoice {
  matterId: string
  title: string
  documents: Array<{ versionId: string; name: string }>
}

type Source = 'filed' | 'upload'

const SELECT = 'h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm'

/**
 * Choose what to review and which playbook to run, then start it. A filed
 * document is the normal case — the review is kept with its matter, and the
 * matter's design sheet decides which conditional rules apply. An upload is
 * for a document with no matter yet, such as a prior plan from another firm;
 * it can be linked to a matter later.
 */
export function NewReviewForm({
  playbooks,
  defaultSlug,
  matters,
  initialMatterId,
}: {
  playbooks: PlaybookChoice[]
  defaultSlug: string
  matters: MatterChoice[]
  initialMatterId: string | null
}) {
  const router = useRouter()
  const [source, setSource] = useState<Source>(matters.length > 0 ? 'filed' : 'upload')
  const [matterId, setMatterId] = useState(initialMatterId ?? matters[0]?.matterId ?? '')
  const [versionId, setVersionId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState(defaultSlug)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matter = matters.find(m => m.matterId === matterId) ?? null
  const documents = useMemo(() => matter?.documents ?? [], [matter])
  const chosenVersion = documents.some(d => d.versionId === versionId) ? versionId : (documents[0]?.versionId ?? '')
  const playbook = playbooks.find(p => p.slug === slug) ?? null
  const ready = Boolean(slug) && (source === 'filed' ? Boolean(chosenVersion) : Boolean(file))

  const submit = async () => {
    if (!ready) return
    setSubmitting(true)
    setError(null)
    const body = new FormData()
    body.set('playbookSlug', slug)
    if (source === 'filed') {
      body.set('documentVersionId', chosenVersion)
    } else if (file) {
      body.set('document', file)
      if (label.trim()) body.set('label', label.trim())
    }
    try {
      const response = await fetch('/api/admin/review', { method: 'POST', body })
      const payload = (await response.json().catch(() => ({}))) as { runId?: string; error?: string }
      if (!response.ok || !payload.runId) {
        setError(payload.error ?? `The review could not be started (${response.status}).`)
        return
      }
      router.push(`/admin/review/${payload.runId}`)
    } catch {
      setError('Cornerstone could not be reached. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className="space-y-5"
      data-testid="new-review-form"
      onSubmit={event => {
        event.preventDefault()
        void submit()
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What to review</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="source"
              checked={source === 'filed'}
              disabled={matters.length === 0}
              onChange={() => setSource('filed')}
            />
            A document on a matter
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="source" checked={source === 'upload'} onChange={() => setSource('upload')} />
            Upload a file (a prior plan, or a document with no matter yet)
          </label>
        </div>

        {source === 'filed' ? (
          <div className="space-y-2">
            <select aria-label="Matter" className={SELECT} value={matterId} onChange={e => setMatterId(e.target.value)}>
              {matters.map(m => (
                <option key={m.matterId} value={m.matterId}>
                  {m.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Document"
              className={SELECT}
              value={chosenVersion}
              onChange={e => setVersionId(e.target.value)}
            >
              {documents.map(d => (
                <option key={d.versionId} value={d.versionId}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The current version of each Word or PDF document on a hired matter. The matter&apos;s design sheet decides
              which conditional rules apply.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              aria-label="File to review"
              type="file"
              accept=".docx,.pdf"
              className="block text-sm"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <input
              aria-label="Name for this document"
              type="text"
              placeholder="Name (optional), e.g. Smith — 2019 will from prior counsel"
              className={SELECT}
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A Word or PDF file. It is kept with the review, not added to any matter&apos;s documents; every rule runs
              until you link it to a matter.
            </p>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Playbook</legend>
        <select aria-label="Playbook" className={SELECT} value={slug} onChange={e => setSlug(e.target.value)}>
          {playbooks.map(p => (
            <option key={p.slug} value={p.slug}>
              {p.title}
            </option>
          ))}
        </select>
        {playbook ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{playbook.rules.length} rules</summary>
            <ol className="mt-2 space-y-1">
              {playbook.rules.map(rule => (
                <li key={rule.number}>
                  <span className="font-medium text-foreground">
                    {rule.number}. [{rule.risk}]
                  </span>{' '}
                  {rule.statement}
                  {rule.appliesWhen.length > 0 ? ` (only when ${rule.appliesWhen.join('; ')})` : ''}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!ready || submitting}>
        {submitting ? 'Starting…' : 'Start review'}
      </Button>
    </form>
  )
}
