'use client'

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { CandidateRule, ExtractRulesResult } from '@aubrey-law/citations/playbookBuilder/extractRules'
import {
  APPLIES_WHEN,
  APPLIES_WHEN_LABELS,
  describeCondition,
  type RuleCondition,
} from '@aubrey-law/citations/review/conditions'
import { slugFromTitle } from '@/lib/playbooks/slug'
import { publishPlaybook } from './actions'

type Risk = CandidateRule['risk']
const RISKS: Risk[] = ['blocker', 'high', 'medium', 'low']

export interface PublishedPlaybookChoice {
  slug: string
  title: string
  version: number
  rules: Array<{ statement: string; risk: Risk; preferredLanguage: string | null; conditions: RuleCondition[] }>
}

export interface BuilderRule {
  key: string
  statement: string
  risk: Risk
  preferredLanguage: string
  included: boolean
  origin: 'published' | 'extracted' | 'manual'
  topic: string | null
  /** All must hold for the rule to run on a matter. Empty: always. */
  conditions: RuleCondition[]
  source: {
    blockIndex: number | null
    quote: string
    verified: boolean
  } | null
}

interface ExtractResponse extends ExtractRulesResult {
  filename: string
  paragraphCount: number
}

let keyCounter = 0
const nextKey = (prefix: string) => `${prefix}-${++keyCounter}`

export function rowsFromPublished(playbook: PublishedPlaybookChoice): BuilderRule[] {
  return playbook.rules.map((rule) => ({
    key: nextKey('p'),
    statement: rule.statement,
    risk: rule.risk,
    preferredLanguage: rule.preferredLanguage ?? '',
    included: true,
    origin: 'published',
    topic: null,
    conditions: rule.conditions,
    source: null,
  }))
}

/**
 * Candidates arrive ticked only when their quote was verified. An unverified
 * candidate may still state a real position, but nobody has seen the clause it
 * claims to come from, so it waits for a person to tick it.
 */
export function rowsFromCandidates(candidates: CandidateRule[]): BuilderRule[] {
  return candidates.map((candidate) => ({
    key: nextKey('x'),
    statement: candidate.statement,
    risk: candidate.risk,
    preferredLanguage: candidate.preferredLanguage ?? '',
    included: candidate.citation !== null,
    origin: 'extracted',
    topic: candidate.topic,
    conditions: candidate.conditions,
    source: candidate.citation
      ? { blockIndex: candidate.citation.blockIndex, quote: candidate.citation.quote, verified: true }
      : candidate.attemptedQuote
        ? { blockIndex: null, quote: candidate.attemptedQuote, verified: false }
        : null,
  }))
}

export function PlaybookBuilder({ playbooks }: { playbooks: PublishedPlaybookChoice[] }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [base, setBase] = useState('')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [documentType, setDocumentType] = useState('')
  const [changeSummary, setChangeSummary] = useState('')
  const [rules, setRules] = useState<BuilderRule[]>([])
  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState<ExtractResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [published, setPublished] = useState<{ slug: string; versionNumber: number; ruleCount: number } | null>(null)
  const [publishing, startPublish] = useTransition()

  const basePlaybook = playbooks.find((p) => p.slug === base) ?? null
  const included = rules.filter((rule) => rule.included)

  const chooseBase = (next: string) => {
    setBase(next)
    setPublished(null)
    const playbook = playbooks.find((p) => p.slug === next)
    if (playbook) {
      setTitle(playbook.title)
      setSlug(playbook.slug)
      setSlugTouched(true)
      // Extracted and hand-added rules survive a change of base; only the
      // previous base's own rules are swapped out.
      setRules((current) => [...rowsFromPublished(playbook), ...current.filter((r) => r.origin !== 'published')])
    } else {
      setSlugTouched(false)
      setSlug(slugFromTitle(title))
      setRules((current) => current.filter((r) => r.origin !== 'published'))
    }
  }

  const update = (key: string, patch: Partial<BuilderRule>) =>
    setRules((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)))

  const move = (key: string, by: -1 | 1) =>
    setRules((current) => {
      const index = current.findIndex((rule) => rule.key === key)
      const target = index + by
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const remove = (key: string) => setRules((current) => current.filter((rule) => rule.key !== key))

  const addManual = () =>
    setRules((current) => [
      ...current,
      {
        key: nextKey('m'),
        statement: '',
        risk: 'medium',
        preferredLanguage: '',
        included: true,
        origin: 'manual',
        topic: null,
        conditions: [],
        source: null,
      },
    ])

  const onExtract = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Choose the precedent to read.')
      return
    }
    setExtracting(true)
    setError(null)
    setPublished(null)
    const body = new FormData()
    body.set('document', file)
    if (documentType.trim()) body.set('documentType', documentType.trim())
    try {
      const response = await fetch('/api/admin/playbooks/extract', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) {
        setError(typeof payload?.error === 'string' ? payload.error : 'The precedent could not be read.')
        return
      }
      const result = payload as ExtractResponse
      setExtraction(result)
      setRules((current) => [...current, ...rowsFromCandidates(result.candidates)])
      if (!title && !basePlaybook) {
        const suggested = documentType.trim()
          ? `Massachusetts ${documentType.trim()} — firm quality review`
          : file.name.replace(/\.(docx|pdf)$/i, '')
        setTitle(suggested)
        if (!slugTouched) setSlug(slugFromTitle(suggested))
      }
    } catch {
      setError('The builder could not be reached. Check your connection and try again.')
    } finally {
      setExtracting(false)
    }
  }

  const onPublish = () => {
    setError(null)
    const blank = included.findIndex((rule) => !rule.statement.trim())
    if (blank >= 0) {
      setError(`Rule ${blank + 1} has no statement. Write one or untick it.`)
      return
    }
    startPublish(async () => {
      const result = await publishPlaybook({
        slug,
        title,
        changeSummary:
          changeSummary.trim() ||
          (extraction ? `Built from ${extraction.filename}${basePlaybook ? ` on version ${basePlaybook.version}` : ''}.` : null),
        rules: included.map((rule) => ({
          statement: rule.statement,
          risk: rule.risk,
          preferredLanguage: rule.preferredLanguage,
          conditions: rule.conditions,
        })),
      })
      if (result.ok) setPublished(result)
      else setError(result.message)
    })
  }

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <Link href="/admin/review" className="text-xs text-muted-foreground underline underline-offset-4">
            Reviews
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Build a playbook</h1>
        </div>
        <Link href="/admin/review/new" className="text-sm underline underline-offset-4">
          Start a review
        </Link>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-8 px-6 py-8">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">1. Playbook</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Start from</span>
              <select
                aria-label="Start from"
                value={base}
                onChange={(event) => chooseBase(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">A new playbook</option>
                {playbooks.map((playbook) => (
                  <option key={playbook.slug} value={playbook.slug}>
                    {playbook.title} (v{playbook.version}, {playbook.rules.length} rules)
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Document type</span>
              <input
                aria-label="Document type"
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
                placeholder="revocable trust, will, durable power of attorney…"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Title</span>
              <input
                aria-label="Title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  if (!slugTouched) setSlug(slugFromTitle(event.target.value))
                }}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Playbook id</span>
              <input
                aria-label="Playbook id"
                value={slug}
                disabled={Boolean(basePlaybook)}
                onChange={(event) => {
                  setSlug(event.target.value)
                  setSlugTouched(true)
                }}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono text-sm disabled:opacity-60"
              />
            </label>
          </div>
          {basePlaybook ? (
            <p className="text-xs text-muted-foreground">
              Publishing creates version {basePlaybook.version + 1} of “{basePlaybook.title}”. Version{' '}
              {basePlaybook.version} and every review already run against it stay as they are.
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">2. Read a precedent</h2>
          <p className="text-xs text-muted-foreground">
            Upload a document the firm has approved. Each position it takes is proposed as a rule, with
            the clause it came from. A clause offered as preferred language is the precedent’s own text,
            checked against the document, never a rewrite.
          </p>
          <form onSubmit={onExtract} className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              name="document"
              accept=".pdf,.docx"
              aria-label="Precedent"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
            <Button type="submit" disabled={extracting}>
              {extracting ? 'Reading… (a minute or two)' : 'Propose rules'}
            </Button>
          </form>
          {extraction ? (
            <p className="text-xs text-muted-foreground" data-testid="extraction-summary">
              {extraction.filename}: {extraction.paragraphCount} paragraphs read in {extraction.windows.length}{' '}
              {extraction.windows.length === 1 ? 'pass' : 'passes'}, {extraction.candidates.length} rules proposed.
              {extraction.failures.length > 0 ? (
                <span className="text-destructive">
                  {' '}
                  {extraction.failures.length} {extraction.failures.length === 1 ? 'pass' : 'passes'} failed (
                  {extraction.failures
                    .map((f) => `¶ ${f.window.firstBlock}–${f.window.lastBlock}`)
                    .join(', ')}
                  ) — those paragraphs proposed nothing. Run it again to retry.
                </span>
              ) : null}
            </p>
          ) : null}
        </section>

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              3. Approve the rules{' '}
              <span className="font-normal text-muted-foreground">
                ({included.length} of {rules.length} included)
              </span>
            </h2>
            <Button type="button" variant="outline" onClick={addManual}>
              Add a rule
            </Button>
          </div>
          {rules.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
              No rules yet. Start from a published playbook, read a precedent, or add a rule by hand. The
              positions a precedent is silent on — what it should say and doesn’t — have to be added by hand.
            </p>
          ) : (
            <ol className="space-y-3">
              {rules.map((rule, index) => (
                <RuleRow
                  key={rule.key}
                  rule={rule}
                  number={rule.included ? included.indexOf(rule) + 1 : null}
                  first={index === 0}
                  last={index === rules.length - 1}
                  onChange={(patch) => update(rule.key, patch)}
                  onMove={(by) => move(rule.key, by)}
                  onRemove={() => remove(rule.key)}
                />
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-3 border-t border-border pt-6">
          <h2 className="text-sm font-semibold">4. Publish</h2>
          <input
            aria-label="What changed"
            value={changeSummary}
            onChange={(event) => setChangeSummary(event.target.value)}
            placeholder="What changed in this version (optional)"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={onPublish} disabled={publishing || included.length === 0}>
              {publishing ? 'Publishing…' : `Publish ${included.length} ${included.length === 1 ? 'rule' : 'rules'}`}
            </Button>
            {published ? (
              <p className="text-sm" data-testid="published">
                Published version {published.versionNumber} with {published.ruleCount} rules.{' '}
                <Link href={`/admin/review/new?playbook=${encodeURIComponent(published.slug)}`} className="underline underline-offset-4">
                  Test it on a draft
                </Link>
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}

function RuleRow({
  rule,
  number,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  rule: BuilderRule
  number: number | null
  first: boolean
  last: boolean
  onChange: (patch: Partial<BuilderRule>) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <li
      className={`space-y-2 rounded-md border p-3 ${rule.included ? 'border-border' : 'border-dashed border-border opacity-70'}`}
      data-testid="builder-rule"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rule.included}
            onChange={(event) => onChange({ included: event.target.checked })}
            aria-label="Include this rule"
          />
          <span className="font-medium">{number ? `Rule ${number}` : 'Not included'}</span>
        </label>
        {rule.topic ? <span className="text-xs text-muted-foreground">· {rule.topic}</span> : null}
        <span className="text-xs text-muted-foreground">
          · {rule.origin === 'published' ? 'current version' : rule.origin === 'extracted' ? 'from precedent' : 'added by hand'}
        </span>
        <select
          aria-label="Risk"
          value={rule.risk}
          onChange={(event) => onChange({ risk: event.target.value as Risk })}
          className="ml-auto h-8 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          {RISKS.map((risk) => (
            <option key={risk} value={risk}>
              {risk}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onMove(-1)} disabled={first} className="text-xs underline disabled:opacity-40">
          Up
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={last} className="text-xs underline disabled:opacity-40">
          Down
        </button>
        <button type="button" onClick={onRemove} className="text-xs text-destructive underline">
          Remove
        </button>
      </div>
      <textarea
        aria-label="Rule statement"
        value={rule.statement}
        onChange={(event) => onChange({ statement: event.target.value })}
        rows={3}
        className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
      />
      <textarea
        aria-label="Preferred language"
        value={rule.preferredLanguage}
        onChange={(event) => onChange({ preferredLanguage: event.target.value })}
        rows={rule.preferredLanguage ? 3 : 1}
        placeholder="Preferred language (optional)"
        className="w-full rounded-md border border-input bg-transparent p-2 font-serif text-sm"
      />
      <ConditionsEditor conditions={rule.conditions} onChange={(conditions) => onChange({ conditions })} />
      {rule.source ? (
        <details className="text-xs">
          <summary className={rule.source.verified ? 'text-muted-foreground' : 'text-destructive'}>
            {rule.source.verified
              ? `Source: ¶ ${rule.source.blockIndex} of the precedent`
              : 'Source quote not found in the precedent — check the position before including it'}
          </summary>
          <blockquote className="mt-1 border-l-2 border-border pl-2 font-serif text-muted-foreground">
            {rule.source.quote}
          </blockquote>
          {rule.source.verified && rule.source.quote !== rule.preferredLanguage ? (
            <button
              type="button"
              onClick={() => onChange({ preferredLanguage: rule.source!.quote })}
              className="mt-1 underline"
            >
              Use this clause as preferred language
            </button>
          ) : null}
        </details>
      ) : null}
    </li>
  )
}

const sameCondition = (a: RuleCondition, b: RuleCondition) => JSON.stringify(a) === JSON.stringify(b)

/**
 * When a rule applies, as chips. Added from a fixed list — the same words the
 * precedent reader suggests — so every condition names a fact the review can
 * test. The one number, the estate threshold, stays editable.
 */
export function ConditionsEditor({
  conditions,
  onChange,
}: {
  conditions: RuleCondition[]
  onChange: (conditions: RuleCondition[]) => void
}) {
  const available = Object.entries(APPLIES_WHEN).filter(
    ([, condition]) => !conditions.some((existing) => sameCondition(existing, condition)),
  )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="rule-conditions">
      <span className="text-muted-foreground">Applies</span>
      {conditions.length === 0 ? <span>to every matter</span> : <span>only when</span>}
      {conditions.map((condition, index) => (
        <span key={index} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5">
          {condition.test === 'at_least' ? (
            <>
              estate is at least $
              <input
                type="number"
                min={0}
                step={100000}
                aria-label="Estate threshold"
                value={condition.value}
                onChange={(event) =>
                  onChange(
                    conditions.map((c, i) =>
                      i === index && c.test === 'at_least' ? { ...c, value: Math.max(0, Number(event.target.value) || 0) } : c,
                    ),
                  )
                }
                className="w-28 bg-transparent"
              />
            </>
          ) : (
            describeCondition(condition)
          )}
          <button
            type="button"
            aria-label={`Remove condition: ${describeCondition(condition)}`}
            onClick={() => onChange(conditions.filter((_, i) => i !== index))}
            className="text-muted-foreground"
          >
            ×
          </button>
        </span>
      ))}
      {available.length > 0 ? (
        <select
          aria-label="Add a condition"
          value=""
          onChange={(event) => {
            const condition = APPLIES_WHEN[event.target.value]
            if (condition) onChange([...conditions, condition])
          }}
          className="h-7 rounded-md border border-input bg-transparent px-1 text-xs"
        >
          <option value="">+ condition</option>
          {available.map(([word]) => (
            <option key={word} value={word}>
              {APPLIES_WHEN_LABELS[word] ?? word}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}
