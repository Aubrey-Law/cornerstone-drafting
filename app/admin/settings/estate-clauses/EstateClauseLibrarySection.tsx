'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpenText, Loader2, Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { EstateClauseEditor } from './EstateClauseEditor'
import { EstateClauseReviewPanel } from './EstateClauseReviewPanel'
import type { ClauseRevisionDto, EstateClauseAdminDto, EstateClauseListResponse } from './types'
import { documentTypeLabels } from './types'
import type { EstateDocumentType } from '@/lib/estateClauses/types'

type FilterStatus = 'all' | 'awaiting_review' | 'working_draft' | 'published' | 'unpublished'
type Selection = { mode: 'edit'; clauseId: string } | { mode: 'review'; clauseId: string; revisionId: string }

function statusOf(clause: EstateClauseAdminDto): FilterStatus {
  if (clause.submittedRevisions.length) return 'awaiting_review'
  if (clause.workingDraft) return 'working_draft'
  if (clause.currentPublication) return 'published'
  return 'unpublished'
}

const statusLabel: Record<FilterStatus, string> = {
  all: 'All statuses', awaiting_review: 'Awaiting review', working_draft: 'Working draft', published: 'Published', unpublished: 'Unpublished',
}
const documentTypes = Object.keys(documentTypeLabels) as EstateDocumentType[]

export function EstateClauseLibrarySection({ currentUserId }: { currentUserId: string }) {
  const token = useAccessToken()
  const [clauses, setClauses] = useState<EstateClauseAdminDto[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterStatus>('all')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newClause, setNewClause] = useState<{ clauseKey: string; title: string; documentTypes: EstateDocumentType[] }>({ clauseKey: '', title: '', documentTypes: [] })
  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!token) return {} as Record<string, string>
    return { Authorization: `Bearer ${token}` }
  }, [token])

  const load = useCallback(async () => {
    if (!token) return
    setError(null)
    try {
      const response = await fetch('/api/admin/settings/estate-clauses', { headers: authHeaders })
      const body = await response.json().catch(() => ({})) as Partial<EstateClauseListResponse> & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Unable to load estate clauses')
      setClauses(body.clauses ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load estate clauses')
    } finally { setLoading(false) }
  }, [authHeaders, token])

  useEffect(() => { void load() }, [load])

  const visible = clauses.filter(clause => {
    const needle = query.trim().toLowerCase()
    const matchesQuery = !needle || `${clause.title} ${clause.clauseKey} ${clause.documentTypes.join(' ')}`.toLowerCase().includes(needle)
    return matchesQuery && (filter === 'all' || statusOf(clause) === filter)
  })
  const selectedClause = selection ? clauses.find(clause => clause.id === selection.clauseId) ?? null : null
  const selectedRevision: ClauseRevisionDto | null = selection?.mode === 'review' && selectedClause
    ? selectedClause.submittedRevisions.find(revision => revision.id === selection.revisionId) ?? null
    : null

  const createClause = async () => {
    setCreating(true); setCreateError(null)
    try {
      const response = await fetch('/api/admin/settings/estate-clauses', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(newClause),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Unable to create clause')
      setShowCreate(false)
      setNewClause({ clauseKey: '', title: '', documentTypes: [] })
      await load()
    } catch (cause) { setCreateError(cause instanceof Error ? cause.message : 'Unable to create clause') }
    finally { setCreating(false) }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="clause-search">Search clauses</Label>
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input id="clause-search" type="search" className="pl-8" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title, stable key, or document type" /></div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clause-status">Filter by status</Label>
            <select id="clause-status" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:w-48" value={filter} onChange={event => setFilter(event.target.value as FilterStatus)}>
              {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <Button type="button" variant="outline" onClick={() => setShowCreate(value => !value)}><Plus /> New clause</Button>
        </div>
        {showCreate && <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="new-clause-key">Stable clause key</Label><Input id="new-clause-key" className="font-mono text-xs" value={newClause.clauseKey} onChange={event => setNewClause(current => ({ ...current, clauseKey: event.target.value }))} placeholder="trust.special_distribution" /></div>
            <div className="space-y-1.5"><Label htmlFor="new-clause-title">Clause title</Label><Input id="new-clause-title" value={newClause.title} onChange={event => setNewClause(current => ({ ...current, title: event.target.value }))} /></div>
          </div>
          <fieldset><legend className="text-sm font-medium">Compatible document types</legend><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{documentTypes.map(type => <label key={type} className="flex items-center gap-2 text-xs"><Checkbox checked={newClause.documentTypes.includes(type)} onCheckedChange={checked => setNewClause(current => ({ ...current, documentTypes: checked ? [...current.documentTypes, type] : current.documentTypes.filter(item => item !== type) }))} />{documentTypeLabels[type]}</label>)}</div></fieldset>
          {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
          <div className="flex justify-end"><Button disabled={creating || !newClause.clauseKey.trim() || !newClause.title.trim() || newClause.documentTypes.length === 0} onClick={() => void createClause()}>{creating && <Loader2 className="animate-spin" />} Create working clause</Button></div>
        </div>}
      </div>

      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>}
      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading clause library…</div> : (
        <div className="grid min-h-[34rem] gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside aria-label="Estate clauses" className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold">{visible.length} clauses</span>
              <Badge variant="outline">MA only</Badge>
            </div>
            <div className="max-h-[46rem] divide-y divide-border overflow-y-auto">
              {visible.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No clauses match these filters.</p>}
              {visible.map(clause => {
                const status = statusOf(clause)
                const revision = clause.submittedRevisions[0]
                const review = Boolean(revision)
                return <article key={clause.id} className="space-y-2 p-3 hover:bg-muted/30">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><h4 className="truncate text-sm font-semibold">{clause.title}</h4><p className="truncate font-mono text-[10px] text-muted-foreground">{clause.clauseKey}</p></div>
                    <Badge variant={status === 'awaiting_review' ? 'default' : 'outline'} className="text-[10px]">{statusLabel[status]}</Badge>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{clause.documentTypes.map(type => documentTypeLabels[type]).join(' · ')}</p>
                  <Button size="sm" variant={selection?.clauseId === clause.id ? 'default' : 'outline'} className="h-7 w-full text-xs" onClick={() => setSelection(review ? { mode: 'review', clauseId: clause.id, revisionId: revision.id } : { mode: 'edit', clauseId: clause.id })}>
                    {review ? `Review ${clause.title}` : `Edit ${clause.title}`}
                  </Button>
                </article>
              })}
            </div>
          </aside>

          <main className="min-w-0">
            {!selectedClause && <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-border p-8 text-center"><BookOpenText className="size-8 text-muted-foreground" /><h3 className="mt-3 font-serif text-lg font-semibold">Select a clause</h3><p className="mt-1 max-w-md text-sm text-muted-foreground">Choose a working draft to edit or a submitted revision to review against the current publication.</p></div>}
            {selectedClause && selection?.mode === 'edit' && <EstateClauseEditor key={selectedClause.id} clause={selectedClause} authHeaders={authHeaders} onRefresh={load} />}
            {selectedClause && selection?.mode === 'review' && selectedRevision && <EstateClauseReviewPanel key={selectedRevision.id} clause={selectedClause} revision={selectedRevision} currentUserId={currentUserId} authHeaders={authHeaders} onRefresh={load} />}
          </main>
        </div>
      )}
    </div>
  )
}
