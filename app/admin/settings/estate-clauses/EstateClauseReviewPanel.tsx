'use client'

import { useState } from 'react'
import { Download, Eye, Loader2, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ClauseRevisionDto, EstateClauseAdminDto } from './types'
import { validationMessages } from './types'

interface PreviewFile { filename: string; base64: string }

export function EstateClauseReviewPanel({
  clause,
  revision,
  currentUserId,
  authHeaders,
  onRefresh,
}: {
  clause: EstateClauseAdminDto
  revision: ClauseRevisionDto
  currentUserId: string
  authHeaders: HeadersInit
  onRefresh: () => Promise<void>
}) {
  const [confirmation, setConfirmation] = useState('')
  const [comment, setComment] = useState('')
  const [matterId, setMatterId] = useState('')
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([])
  const [previewReport, setPreviewReport] = useState<unknown>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const selfAuthored = revision.authorId === currentUserId
  const published = clause.currentPublication?.revision ?? null
  const validation = validationMessages(revision.validationReport)

  async function call(body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/settings/estate-clauses/${clause.id}/review`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Review request failed')
  }

  const publish = async () => {
    setBusy('publish'); setError(null); setNotice(null)
    try {
      await call({ action: 'publish', expectedCurrentRevisionId: clause.currentPublication?.current_revision_id ?? null })
      setNotice('Revision approved and published.')
      await onRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to publish revision') }
    finally { setBusy(null) }
  }

  const requestChanges = async () => {
    setBusy('changes'); setError(null); setNotice(null)
    try {
      await call({ action: 'request_changes', comment })
      setNotice('Changes requested from the author.')
      await onRefresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to request changes') }
    finally { setBusy(null) }
  }

  const preview = async () => {
    setBusy('preview'); setError(null); setNotice(null); setPreviewFiles([]); setPreviewReport(null)
    try {
      const response = await fetch(`/api/admin/settings/estate-clauses/${clause.id}/preview`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ revisionId: revision.id, matterId }),
      })
      const data = await response.json().catch(() => ({})) as { error?: string; files?: PreviewFile[]; validationReport?: unknown }
      if (!response.ok) throw new Error(data.error ?? 'Unable to preview revision')
      setPreviewFiles(data.files ?? [])
      setPreviewReport(data.validationReport ?? null)
      setNotice('Preview generated in memory. No document was saved.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to preview revision') }
    finally { setBusy(null) }
  }

  return (
    <section aria-label="Clause review" className="space-y-5 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Independent review</p>
          <h3 className="font-serif text-xl font-semibold">{clause.title}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{clause.clauseKey} · revision {revision.revisionNumber}</p>
        </div>
        <Badge variant={revision.validationStatus === 'valid' ? 'default' : 'destructive'}>{revision.validationStatus}</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <article className="min-w-0 rounded-md border border-border bg-muted/20 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Published revision</h4>
          <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-5">{published?.text ?? 'No revision is currently published.'}</pre>
        </article>
        <article className="min-w-0 rounded-md border border-primary/30 bg-primary/5 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-primary">Proposed revision</h4>
          <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-5">{revision.text}</pre>
        </article>
      </div>

      <dl className="grid gap-3 rounded-md border border-border p-3 text-xs sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Author</dt><dd className="mt-1 font-mono">{revision.authorId}</dd></div>
        <div><dt className="text-muted-foreground">Submitted</dt><dd className="mt-1">{new Date(revision.submittedAt).toLocaleString()}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted-foreground">Mandatory change summary</dt><dd className="mt-1 font-medium">{revision.changeSummary}</dd></div>
      </dl>

      <div className="rounded-md border border-border p-3 text-xs">
        <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-primary" /> Validation report</div>
        {validation.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{validation.map(item => <li key={item}>{item}</li>)}</ul> : <p className="mt-2 text-muted-foreground">No validation findings.</p>}
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-3">
        <Label htmlFor={`matter-${revision.id}`}>Representative matter ID for preview</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input id={`matter-${revision.id}`} className="font-mono text-xs" value={matterId} onChange={event => { setMatterId(event.target.value); setPreviewFiles([]); setPreviewReport(null); setNotice(null) }} placeholder="UUID" />
          <Button variant="outline" disabled={!matterId.trim() || busy !== null} onClick={() => void preview()}>{busy === 'preview' ? <Loader2 className="animate-spin" /> : <Eye />} Preview</Button>
        </div>
        {previewFiles.length > 0 && <ul className="mt-3 space-y-1">{previewFiles.map(file => <li key={file.filename}><a className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline" download={file.filename} href={`data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${file.base64}`}><Download className="size-3.5" />{file.filename}</a></li>)}</ul>}
        {previewReport !== null && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px]">{JSON.stringify(previewReport, null, 2)}</pre>}
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

      {selfAuthored ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground">A different attorney or administrator must publish this revision.</p>
      ) : (
        <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`comment-${revision.id}`}>Reviewer comments</Label>
            <Textarea id={`comment-${revision.id}`} value={comment} onChange={event => setComment(event.target.value)} placeholder="Required when requesting changes" />
            <Button variant="outline" disabled={!comment.trim() || busy !== null} onClick={() => void requestChanges()}>{busy === 'changes' && <Loader2 className="animate-spin" />} Request changes</Button>
          </div>
          <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
            <Label htmlFor={`confirm-${revision.id}`}>Type {clause.clauseKey} to confirm</Label>
            <Input id={`confirm-${revision.id}`} className="font-mono text-xs" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
            <p className="text-[11px] text-muted-foreground">Publication is immediate and this revision becomes the current immutable clause.</p>
            <Button disabled={confirmation !== clause.clauseKey || revision.validationStatus !== 'valid' || busy !== null} onClick={() => void publish()}>{busy === 'publish' ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Approve and publish</Button>
          </div>
        </div>
      )}
    </section>
  )
}
