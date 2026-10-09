'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CustomQuestionField } from '@/components/forms/CustomQuestionField'
import { supabase } from '@/lib/supabaseClient'
import { evaluateClientForm, type ClientFormAnswer, type ClientFormAnswers, type ClientFormIssue } from '@/lib/forms/clientFormAnswers'
import type { CompiledIntakeForm } from '@/lib/intake/forms/compiler'

type Assignment = { id: string; title: string; status: 'sent' | 'in_progress' | 'submitted'; answers: ClientFormAnswers; revision: number; submittedAt: string | null }
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

/**
 * Fill in one client form. Answers autosave (debounced) against the form's
 * revision; submitting checks required answers here and again on the server.
 */
export function ClientFormFiller({ form, assignment }: { form: CompiledIntakeForm; assignment: Assignment }) {
  const [answers, setAnswers] = useState<ClientFormAnswers>(assignment.answers)
  const [submitted, setSubmitted] = useState(assignment.status === 'submitted')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [showIssues, setShowIssues] = useState(false)
  const [serverIssues, setServerIssues] = useState<ClientFormIssue[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const revision = useRef(assignment.revision)
  const latest = useRef(answers)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const dirty = useRef(false)

  const evaluation = useMemo(() => evaluateClientForm(form, answers), [form, answers])
  const issues = serverIssues ?? evaluation.issues
  const issueFor = (itemId: string) => showIssues ? issues.find(issue => issue.itemId === itemId)?.message ?? null : null

  // Saves run one at a time so each carries the revision the previous returned.
  const save = useCallback((submit: boolean) => {
    const run = chain.current.then(async () => {
      setSaveState('saving')
      dirty.current = false
      const response = await fetch(`/api/portal/forms/${assignment.id}`, {
        method: 'PUT', headers: await authHeaders(),
        body: JSON.stringify({ revision: revision.current, answers: latest.current, submit }),
      })
      const json = await response.json().catch(() => ({})) as { revision?: number; issues?: ClientFormIssue[]; error?: string }
      if (response.status === 409) { setSaveState('conflict'); return false }
      if (response.status === 422 && json.issues) { setServerIssues(json.issues); setShowIssues(true); setSaveState('saved'); return false }
      if (!response.ok || typeof json.revision !== 'number') { setSaveState('error'); dirty.current = true; return false }
      revision.current = json.revision
      setSaveState('saved')
      return true
    }).catch(() => { setSaveState('error'); dirty.current = true; return false })
    chain.current = run
    return run
  }, [assignment.id])

  const update = (id: string, value: ClientFormAnswer) => {
    if (submitted) return
    const next = { ...latest.current, [id]: value }
    latest.current = next
    setAnswers(next)
    setServerIssues(null)
    dirty.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void save(false) }, 1200)
  }

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); if (timer.current) clearTimeout(timer.current) }
  }, [])

  async function submit() {
    setShowIssues(true)
    if (evaluation.issues.length) {
      document.getElementById(`question-${evaluation.issues[0].itemId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setSubmitting(true)
    try {
      if (await save(true)) setSubmitted(true)
    } finally { setSubmitting(false) }
  }

  const status = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Could not save — check your connection; we will retry on your next change.' : saveState === 'conflict' ? 'This form changed in another window. Reload the page to continue.' : ''

  return (
    <div className="mt-4 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{assignment.title}</h1>
        {form.description ? <p className="mt-1 text-sm text-muted-foreground">{form.description}</p> : null}
      </div>
      {submitted ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green" aria-hidden />
          <p className="text-sm">Thank you — we have received this form. To change an answer, send us a message and we will reopen it.</p>
        </div>
      ) : null}
      {form.sections.map(section => (
        <section key={section.id} aria-labelledby={`section-${section.id}`} className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
          <div>
            <h2 id={`section-${section.id}`} className="text-lg font-semibold">{section.title}</h2>
            {section.subtitle ? <p className="text-sm text-muted-foreground">{section.subtitle}</p> : null}
          </div>
          {section.items.map(item => item.kind === 'question' ? (
            <div key={item.id} id={`question-${item.id}`}>
              <CustomQuestionField question={item} value={answers[item.id]} disabled={submitted} error={issueFor(item.id)} onChange={value => update(item.id, value)} />
            </div>
          ) : null)}
        </section>
      ))}
      {!submitted && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void submit()} disabled={submitting || saveState === 'conflict'}>{submitting ? 'Submitting…' : 'Submit form'}</Button>
          <p role="status" className="text-sm text-muted-foreground">{status}</p>
          {showIssues && issues.length > 0 && <p className="w-full text-sm text-destructive">Please answer {issues.length === 1 ? 'the highlighted question' : `the ${issues.length} highlighted questions`} before submitting.</p>}
        </div>
      )}
    </div>
  )
}
