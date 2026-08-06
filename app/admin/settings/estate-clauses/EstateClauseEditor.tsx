'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle2, Eye, Loader2, Save, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { EstateClauseAdminDto } from './types'
import { documentTypeLabels, validationMessages } from './types'

interface EditorDraft {
  text: string
  requiredFields: string
  nestedClauseKeys: string
  conditionField: string
  changeSummary: string
}

const lines = (value: string) => value.split(/\n|,/).map(item => item.trim()).filter(Boolean)

export function EstateClauseEditor({
  clause,
  authHeaders,
  onRefresh,
}: {
  clause: EstateClauseAdminDto
  authHeaders: HeadersInit
  onRefresh: () => Promise<void>
}) {
  const sourceText = clause.workingDraft?.text ?? clause.currentPublication?.revision.text ?? ''
  const sourceRequiredFields = (clause.workingDraft?.requiredFields ?? clause.currentPublication?.revision.requiredFields ?? []).join('\n')
  const sourceNestedClauseKeys = (clause.workingDraft?.nestedClauseKeys ?? clause.currentPublication?.revision.nestedClauseKeys ?? []).join('\n')
  const sourceConditionField = clause.workingDraft?.conditionField ?? clause.currentPublication?.revision.conditionField ?? ''
  const sourceChangeSummary = clause.workingDraft?.changeSummary ?? ''
  const initial = useMemo<EditorDraft>(() => ({
    text: sourceText,
    requiredFields: sourceRequiredFields,
    nestedClauseKeys: sourceNestedClauseKeys,
    conditionField: sourceConditionField,
    changeSummary: sourceChangeSummary,
  }), [sourceChangeSummary, sourceConditionField, sourceNestedClauseKeys, sourceRequiredFields, sourceText])
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiProposal, setAiProposal] = useState<string | null>(null)

  useEffect(() => setDraft(initial), [initial])

  const patch = (key: keyof EditorDraft, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const complete = Boolean(draft.text.trim() && draft.changeSummary.trim())
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const maySubmit = Boolean(clause.workingDraft?.id && !dirty)

  async function request(url: string, options: RequestInit) {
    const response = await fetch(url, options)
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Request failed')
    return body
  }

  const save = async () => {
    setBusy('save'); setError(null); setNotice(null)
    try {
      await request(`/api/admin/settings/estate-clauses/${clause.id}/draft`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basePublishedRevisionId: clause.currentPublication?.current_revision_id ?? null,
          content: {
            text: draft.text,
            requiredFields: lines(draft.requiredFields),
            nestedClauseKeys: lines(draft.nestedClauseKeys),
            conditionField: draft.conditionField.trim() || null,
          },
          changeSummary: draft.changeSummary,
        }),
      })
      setNotice('Working draft saved.')
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save draft')
    } finally { setBusy(null) }
  }

  const draftWithAi = async () => {
    setBusy('ai'); setError(null); setNotice(null)
    try {
      const body = await request('/api/admin/settings/estate-clauses/draft-ai', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: aiInstructions, existingText: draft.text }),
      })
      const proposal = body.proposal as { text?: unknown } | undefined
      if (typeof proposal?.text !== 'string') throw new Error('AI drafting returned no proposal')
      setAiProposal(proposal.text)
      setNotice('AI proposal is ready. Review it before accepting.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to draft with AI')
    } finally { setBusy(null) }
  }

  const submit = async () => {
    if (!clause.workingDraft) return
    setBusy('submit'); setError(null); setNotice(null)
    try {
      await request(`/api/admin/settings/estate-clauses/${clause.id}/submit`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDraftId: clause.workingDraft.id }),
      })
      setNotice('Revision submitted for deliberate attorney review.')
      await onRefresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit draft')
    } finally { setBusy(null) }
  }

  const report = validationMessages(clause.workingDraft?.validationReport)

  return (
    <section aria-label="Clause editor" className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Working draft</p>
          <h3 className="text-xl font-semibold">{clause.title}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{clause.clauseKey}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">MA</Badge>
          {clause.documentTypes.map(type => <Badge key={type} variant="secondary">{documentTypeLabels[type]}</Badge>)}
        </div>
      </div>

      {clause.latestChangeRequest && (
        <aside className="rounded-md border border-amber-border bg-amber-bg p-3 text-sm">
          <p className="font-medium">Changes requested on revision {clause.latestChangeRequest.revisionNumber}</p>
          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{clause.latestChangeRequest.comment}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Continue in this working draft, then save and submit a new immutable revision.</p>
        </aside>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-2">
          <Label htmlFor={`clause-text-${clause.id}`}>Structured clause text</Label>
          <Textarea id={`clause-text-${clause.id}`} className="min-h-72 resize-y font-mono text-xs leading-5" value={draft.text} disabled={busy !== null} onChange={event => patch('text', event.target.value)} />
          <p className="text-[11px] text-muted-foreground">Structured text only. Word styles, numbering, and sections remain template-owned.</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`required-${clause.id}`}>Required fields</Label>
            <Textarea id={`required-${clause.id}`} className="min-h-24 font-mono text-xs" value={draft.requiredFields} disabled={busy !== null} onChange={event => patch('requiredFields', event.target.value)} placeholder="One field per line" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`nested-${clause.id}`}>Nested clause keys</Label>
            <Textarea id={`nested-${clause.id}`} className="min-h-20 font-mono text-xs" value={draft.nestedClauseKeys} disabled={busy !== null} onChange={event => patch('nestedClauseKeys', event.target.value)} placeholder="One stable key per line" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`condition-${clause.id}`}>Condition field</Label>
            <Input id={`condition-${clause.id}`} className="font-mono text-xs" value={draft.conditionField} disabled={busy !== null} onChange={event => patch('conditionField', event.target.value)} placeholder="Optional" />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`summary-${clause.id}`}>Change summary</Label>
        <Input id={`summary-${clause.id}`} value={draft.changeSummary} disabled={busy !== null} onChange={event => patch('changeSummary', event.target.value)} placeholder="Required: explain the legal or drafting change" />
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-center gap-2"><Bot className="size-4 text-primary" /><Label htmlFor={`ai-${clause.id}`}>AI drafting instructions</Label></div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input id={`ai-${clause.id}`} value={aiInstructions} disabled={busy !== null} onChange={event => setAiInstructions(event.target.value)} placeholder="Describe a narrow revision; do not include client facts" />
          <Button type="button" variant="outline" disabled={!aiInstructions.trim() || busy !== null} onClick={() => void draftWithAi()}>
            {busy === 'ai' ? <Loader2 className="animate-spin" /> : <Bot />} Draft with AI
          </Button>
        </div>
        {aiProposal !== null && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <Label htmlFor={`proposal-${clause.id}`}>AI proposal — attorney review required</Label>
            <Textarea id={`proposal-${clause.id}`} className="min-h-32 font-mono text-xs" value={aiProposal} disabled={busy !== null} onChange={event => setAiProposal(event.target.value)} />
            <Button type="button" size="sm" disabled={busy !== null} onClick={() => { patch('text', aiProposal); setAiProposal(null); setNotice('AI proposal accepted into the unsaved working draft.') }}>
              Accept draft
            </Button>
          </div>
        )}
      </div>

      {clause.workingDraft && (
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Validation</span>
            <Badge variant={clause.workingDraft.validationStatus === 'valid' ? 'default' : 'destructive'}>{clause.workingDraft.validationStatus}</Badge>
          </div>
          {report.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{report.map(message => <li key={message}>{message}</li>)}</ul>}
        </div>
      )}

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-primary" />{notice}</p>}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" disabled title="Preview is available after submission with a representative matter."><Eye /> Preview</Button>
        <Button type="button" variant="outline" disabled={!complete || busy !== null} onClick={() => void save()}>{busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />} Save draft</Button>
        <Button type="button" disabled={!maySubmit || busy !== null} onClick={() => void submit()}>{busy === 'submit' ? <Loader2 className="animate-spin" /> : <Send />} Submit for review</Button>
      </div>
    </section>
  )
}
