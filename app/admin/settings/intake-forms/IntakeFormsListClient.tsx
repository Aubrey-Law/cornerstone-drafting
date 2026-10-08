'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import type { IntakeFormTemplateSummary, IntakeFormVersionRow } from '@/lib/intake/forms/persistenceTypes'
import { parseArchiveResponse, parseCreatedForm, parseSnapshot } from '@/lib/intake/forms/responseParsing'
import { createBlankDefinition } from '@/lib/intake/forms/editorState'

type Creation = { source: IntakeFormTemplateSummary | null; sourceVersions: IntakeFormVersionRow[]; sourceVersionId: string; key: string; name: string; description: string }
const modificationDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York',
})
function sources(summary: IntakeFormTemplateSummary): IntakeFormVersionRow[] {
  return [summary.draft, summary.latestPublished, summary.latestVersion]
    .filter((row): row is IntakeFormVersionRow => row !== null)
    .filter((row, index, rows) => rows.findIndex(other => other.id === row.id) === index)
    .sort((a, b) => b.version - a.version)
}
function TemplateRows({ items, busy, onCreate, onArchive }: {
  items: IntakeFormTemplateSummary[]
  busy: boolean
  onCreate: (summary: IntakeFormTemplateSummary, trigger: HTMLButtonElement) => void
  onArchive: (summary: IntakeFormTemplateSummary, trigger: HTMLButtonElement) => void
}) {
  return items.map(summary => {
    const { template, draft, latestPublished, latestVersion } = summary
    const updatedAt = summary.lastModifiedAt
    return (
      <article key={template.id} aria-labelledby={`form-${template.id}`} className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-card p-4">
        <div className="min-w-0 space-y-2">
          <h3 id={`form-${template.id}`} className="break-words font-medium">{template.name}</h3>
          <p className="break-all text-sm text-muted-foreground">{template.key}</p>
          {template.description && <p className="max-w-xl text-sm">{template.description}</p>}
          <div className="flex flex-wrap gap-2">
            {draft && <Badge variant="secondary">Draft v{draft.version}</Badge>}
            {latestPublished && <Badge variant="outline">Published v{latestPublished.version}</Badge>}
            {latestVersion?.status === 'retired' && <Badge variant="outline">Retired v{latestVersion.version}</Badge>}
            {!latestVersion && <Badge variant="outline">No versions</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">Last modified <time dateTime={updatedAt}>{modificationDate.format(new Date(updatedAt))} ET</time></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/settings/intake-forms/${template.id}`}>{template.archived_at ? 'View' : 'Open'}</Link>
          </Button>
          <Button variant="outline" size="sm" disabled={busy || sources(summary).length === 0} onClick={event => onCreate(summary, event.currentTarget)}>Duplicate</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={event => onArchive(summary, event.currentTarget)}>{template.archived_at ? 'Restore' : 'Archive'}</Button>
        </div>
      </article>
    )
  })
}

export function IntakeFormsListClient({ initialTemplates }: { initialTemplates: IntakeFormTemplateSummary[] }) {
  const router = useRouter()
  const [templates, setTemplates] = useState(initialTemplates)
  const [creation, setCreation] = useState<Creation | null>(null)
  const [pendingArchive, setPendingArchive] = useState<IntakeFormTemplateSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingSource, setLoadingSource] = useState(false)
  const sourceRequest = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const createButton = useRef<HTMLButtonElement | null>(null)

  function restoreFocus(event: Event) {
    event.preventDefault()
    const target = opener.current?.isConnected ? opener.current : createButton.current
    target?.focus()
  }

  async function startCreation(source: IntakeFormTemplateSummary | null, trigger: HTMLButtonElement) {
    opener.current = trigger
    setError(null)
    const requestId = ++sourceRequest.current
    setCreation({ source, sourceVersions: [], sourceVersionId: '', key: '', name: '', description: source?.template.description ?? '' })
    setLoadingSource(Boolean(source))
    if (!source) return
    try {
      const response = await fetch(`/api/admin/settings/intake-forms/${encodeURIComponent(source.template.id)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Unable to load history')
      const detail = parseSnapshot(await response.json(), source.template)
      const versions = [...detail.versions].sort((a, b) => b.version - a.version)
      if (sourceRequest.current === requestId) setCreation(current => current?.source?.template.id === source.template.id ? { ...current, sourceVersions: versions, sourceVersionId: versions[0]?.id ?? '' } : current)
    } catch {
      if (sourceRequest.current === requestId) setError('Could not load the form version history. Close this dialog and try Duplicate again.')
    } finally { if (sourceRequest.current === requestId) setLoadingSource(false) }
  }

  async function create() {
    if (!creation || busy || loadingSource) return
    const { source, sourceVersionId } = creation
    const key = creation.key.trim()
    const name = creation.name.trim()
    const description = creation.description.trim() || null
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(key)) {
      setError('Use a stable key starting with a lowercase letter, followed by lowercase letters, numbers or underscores (up to 80 characters).')
      return
    }
    if (!name || name.length > 160 || (description?.length ?? 0) > 600) {
      setError('Enter a name (up to 160 characters) and a description of up to 600 characters.')
      return
    }
    if (source && !creation.sourceVersions.some(row => row.id === sourceVersionId)) {
      setError('Choose an available source version and try again.')
      return
    }
    setBusy(true); setError(null)
    try {
      const body = source ? { sourceVersionId, key, name, description } : {
        key, name, description,
        definition: { schemaVersion: 1, key, title: name, ...(description ? { description } : {}), sections: [] },
      }
      const response = await fetch(source ? `/api/admin/settings/intake-forms/${source.template.id}/duplicate` : '/api/admin/settings/intake-forms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok) {
        setError(result?.code === 'INTAKE_FORM_CONFLICT'
          ? 'That key may already be in use or the source has changed. Check the key and source version, then try again.'
          : 'Could not create the form. Your entries are preserved. Check the details and try again.')
        return
      }
      let created
      try {
        const selected = creation.sourceVersions.find(row => row.id === sourceVersionId)
        const definition = source && selected ? { ...selected.definition, key } : createBlankDefinition({ key, title: name, ...(description ? { description } : {}) })
        created = parseCreatedForm(result, { key, name, description, definition, existingIds: templates.map(row => row.template.id) })
      } catch {
        setError('The server returned an invalid result. Your entries are preserved. Reload the list to check whether the form was created before trying again.')
        return
      }
      router.push(`/admin/settings/intake-forms/${encodeURIComponent(created.template.id)}`)
    } catch {
      setError('Could not reach the server. Your entries are preserved. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  async function archive() {
    if (!pendingArchive || busy) return
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/admin/settings/intake-forms/${pendingArchive.template.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: !pendingArchive.template.archived_at }),
      })
      const result = await response.json().catch(() => null)
      let template
      try {
        if (!response.ok) throw new Error('Request failed')
        template = parseArchiveResponse(result, pendingArchive.template, !pendingArchive.template.archived_at)
      } catch {
        setError('Could not update the form. The current list is preserved. Try again or reload the list to check its status.')
        return
      }
      setTemplates(current => current.map(summary => summary.template.id === template.id ? {
        ...summary, template,
        lastModifiedAt: Date.parse(template.updated_at) > Date.parse(summary.lastModifiedAt)
          ? template.updated_at : summary.lastModifiedAt,
      } : summary))
      setPendingArchive(null)
    } catch {
      setError('Could not reach the server. The current list is preserved. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  function startArchive(summary: IntakeFormTemplateSummary, trigger: HTMLButtonElement) {
    opener.current = trigger
    setError(null)
    setPendingArchive(summary)
  }
  const active = templates.filter(row => !row.template.archived_at)
  const archived = templates.filter(row => row.template.archived_at)
  const restoring = Boolean(pendingArchive?.template.archived_at)

  return (
    <div className="space-y-6">
      <Button ref={createButton} onClick={event => startCreation(null, event.currentTarget)} disabled={busy}>New blank form</Button>
      {templates.length === 0 ? <p className="text-sm text-muted-foreground">No intake forms yet</p> : (
        <section aria-label="Active intake forms" className="space-y-3">
          <h2 className="text-base font-semibold">Active</h2>
          {active.length ? <TemplateRows items={active} busy={busy} onCreate={startCreation} onArchive={startArchive} /> : <p className="text-sm text-muted-foreground">No active intake forms</p>}
        </section>
      )}
      {archived.length > 0 && <section aria-label="Archived intake forms" className="space-y-3"><h2 className="text-base font-semibold">Archived</h2><TemplateRows items={archived} busy={busy} onCreate={startCreation} onArchive={startArchive} /></section>}

      <Dialog open={creation !== null} onOpenChange={open => { if (!open && !busy) { sourceRequest.current += 1; setCreation(null); setError(null) } }}>
        <DialogContent onCloseAutoFocus={restoreFocus} showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>{creation?.source ? 'Duplicate intake form' : 'New blank intake form'}</DialogTitle>
            <DialogDescription>{creation?.source ? 'Copy a version into an independent new form.' : 'Start an empty draft and add approved fields in the builder.'} The stable key cannot be changed after creation.</DialogDescription>
          </DialogHeader>
          {creation && <form noValidate onSubmit={event => { event.preventDefault(); void create() }} className="space-y-4">
            {creation.source && <div className="space-y-1"><Label htmlFor="source-version">Source version</Label><select id="source-version" className="w-full rounded-md border bg-background p-2 text-sm" value={creation.sourceVersionId} disabled={busy || loadingSource} onChange={event => setCreation({ ...creation, sourceVersionId: event.target.value })}>{creation.sourceVersions.map(row => <option key={row.id} value={row.id}>Version {row.version} · {row.status}</option>)}</select>{loadingSource && <p role="status" className="text-sm text-muted-foreground">Loading version history…</p>}</div>}
            <div className="space-y-1"><Label htmlFor="form-key">Stable key</Label><Input id="form-key" value={creation.key} disabled={busy} maxLength={80} autoComplete="off" onChange={event => setCreation({ ...creation, key: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="form-name">Name</Label><Input id="form-name" value={creation.name} disabled={busy} maxLength={160} onChange={event => setCreation({ ...creation, name: event.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="form-description">Description</Label><Textarea id="form-description" value={creation.description} disabled={busy} maxLength={600} onChange={event => setCreation({ ...creation, description: event.target.value })} /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => { sourceRequest.current += 1; setCreation(null); setError(null) }}>Cancel</Button><Button type="submit" disabled={busy || loadingSource || Boolean(creation.source && !creation.sourceVersionId)}>{busy ? 'Creating…' : creation.source ? 'Duplicate form' : 'Create form'}</Button></DialogFooter>
          </form>}
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingArchive !== null} onOpenChange={open => { if (!open && !busy) { setPendingArchive(null); setError(null) } }}>
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogHeader><AlertDialogTitle>{restoring ? 'Restore' : 'Archive'} {pendingArchive?.template.name}?</AlertDialogTitle><AlertDialogDescription>{restoring ? 'This form will return to the active list.' : 'This form will move to Archived. Its drafts, versions and history will be preserved.'}</AlertDialogDescription></AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); void archive() }}>{busy ? 'Updating…' : restoring ? 'Restore form' : 'Archive form'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
