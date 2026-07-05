'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownAZ, Clock, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate } from '@/lib/utils'
import { stageLabel } from '@/types/database'
import type { DraftingHubMatter } from '@/lib/queries/drafting'

interface DraftingHubClientProps {
  matters: DraftingHubMatter[]
  loadError?: string | null
}

type SortKey = 'updated' | 'client' | 'stage'
type ReadinessFilter = 'all' | 'ready' | 'needs_design' | 'needs_setup'

function matterHaystack(item: DraftingHubMatter): string {
  const m = item.matter
  return [
    item.matterNumber,
    m.matter_id,
    m.client_name,
    m.spouse_name,
    m.matter_name,
    m.client_email,
    m.plan_type,
    m.practice_area,
    m.stage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function matchesSearch(item: DraftingHubMatter, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = matterHaystack(item)
  return tokens.every(token => haystack.includes(token))
}

function readinessBucket(item: DraftingHubMatter): ReadinessFilter {
  if (!item.designSheet) return 'needs_design'
  if (item.setupBlockers.length > 0 || item.includedDocumentLabels.length === 0) return 'needs_setup'
  return 'ready'
}

function sortTimestamp(item: DraftingHubMatter): number {
  const draftAt = item.recentDrafts[0]?.created_at
  const designAt = item.designSheet?.updatedAt
  const matterAt = item.matter.matter_created
  const pick = draftAt ?? designAt ?? matterAt
  return pick ? Date.parse(pick) : 0
}

function readinessLabel(item: DraftingHubMatter) {
  const bucket = readinessBucket(item)
  if (bucket === 'needs_design') return { label: 'Needs design', tone: 'warning' as const }
  if (bucket === 'needs_setup') return { label: 'Setup needed', tone: 'warning' as const }
  return { label: 'Ready', tone: 'success' as const }
}

export default function DraftingHubClient({ matters, loadError = null }: DraftingHubClientProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all')
  const [practiceFilter, setPracticeFilter] = useState<string>('all')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const practiceAreas = useMemo(() => {
    const set = new Set<string>()
    for (const item of matters) {
      const area = item.matter.practice_area?.trim()
      if (area) set.add(area)
    }
    return Array.from(set).sort()
  }, [matters])

  const filtered = useMemo(() => {
    let list = matters.filter(item => matchesSearch(item, search))
    if (readinessFilter !== 'all') {
      list = list.filter(item => readinessBucket(item) === readinessFilter)
    }
    if (practiceFilter !== 'all') {
      list = list.filter(item => item.matter.practice_area === practiceFilter)
    }
    list = [...list].sort((a, b) => {
      if (sortKey === 'client') {
        return (a.matter.client_name ?? '').localeCompare(b.matter.client_name ?? '', undefined, { sensitivity: 'base' })
      }
      if (sortKey === 'stage') {
        return (a.matter.stage ?? '').localeCompare(b.matter.stage ?? '')
      }
      return sortTimestamp(b) - sortTimestamp(a)
    })
    return list
  }, [matters, practiceFilter, readinessFilter, search, sortKey])

  const grouped = useMemo(() => {
    const ready: DraftingHubMatter[] = []
    const needsDesign: DraftingHubMatter[] = []
    const needsSetup: DraftingHubMatter[] = []
    for (const item of filtered) {
      const bucket = readinessBucket(item)
      if (bucket === 'needs_design') needsDesign.push(item)
      else if (bucket === 'needs_setup') needsSetup.push(item)
      else ready.push(item)
    }
    return { ready, needsDesign, needsSetup }
  }, [filtered])

  const flatVisible = useMemo(
    () => [...grouped.ready, ...grouped.needsDesign, ...grouped.needsSetup],
    [grouped],
  )

  useEffect(() => {
    setFocusedIndex(i => Math.min(i, Math.max(flatVisible.length - 1, 0)))
  }, [flatVisible.length])

  const openMatter = useCallback((matterId: string) => {
    router.push(`/admin/drafting/${matterId}`)
  }, [router])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur()
        return
      }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (flatVisible.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setFocusedIndex(i => Math.min(i + 1, flatVisible.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusedIndex(i => Math.max(i - 1, 0))
      } else if (event.key === 'Enter') {
        const item = flatVisible[focusedIndex]
        if (item) openMatter(item.matter.matter_id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flatVisible, focusedIndex, openMatter])

  const emptyMessage = loadError
    ? `Could not load matters: ${loadError}`
    : matters.length === 0
      ? 'No open matters found. Matters must exist in Supabase with a linked intake row (not archived or closed).'
      : search.trim() || readinessFilter !== 'all' || practiceFilter !== 'all'
        ? 'No matters match the current filters.'
        : 'No matters to show.'

  const showGrouped = readinessFilter === 'all' && !search.trim()

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Drafting</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pick a matter to open its drafting workspace — design, generate, and review in one flow.
        </p>
      </div>

      <div className="space-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex max-w-md items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:border-accent">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, matter number, email, plan type…"
            className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            aria-label="Search matters"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ArrowDownAZ className="h-3 w-3" aria-hidden />
            Sort
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="updated">Last activity</option>
              <option value="client">Client name</option>
              <option value="stage">Stage</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Status
            <select
              value={readinessFilter}
              onChange={e => setReadinessFilter(e.target.value as ReadinessFilter)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="all">All</option>
              <option value="ready">Ready to generate</option>
              <option value="needs_design">Needs design sheet</option>
              <option value="needs_setup">Setup needed</option>
            </select>
          </label>
          {practiceAreas.length > 1 && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Practice
              <select
                value={practiceFilter}
                onChange={e => setPracticeFilter(e.target.value)}
                className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              >
                <option value="all">All areas</option>
                {practiceAreas.map(area => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </label>
          )}
          <span className="text-[10px] text-muted-foreground">↑↓ navigate · Enter open · / search</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          ) : showGrouped ? (
            <>
              <Group title="Ready to generate" matters={grouped.ready} onOpen={openMatter} emptyHint="No matters are fully ready." focusedIndex={focusedIndex} flatOffset={0} />
              <Group title="Needs design sheet" matters={grouped.needsDesign} onOpen={openMatter} emptyHint="All matters have a design sheet." focusedIndex={focusedIndex} flatOffset={grouped.ready.length} />
              <Group title="Setup needed" matters={grouped.needsSetup} onOpen={openMatter} emptyHint="No matters with outstanding setup." focusedIndex={focusedIndex} flatOffset={grouped.ready.length + grouped.needsDesign.length} />
            </>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {filtered.map((item, index) => (
                <MatterCard
                  key={item.matter.matter_id}
                  item={item}
                  focused={index === focusedIndex}
                  onOpen={() => openMatter(item.matter.matter_id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({
  title,
  matters,
  onOpen,
  emptyHint,
  focusedIndex,
  flatOffset,
}: {
  title: string
  matters: DraftingHubMatter[]
  onOpen: (id: string) => void
  emptyHint: string
  focusedIndex: number
  flatOffset: number
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <Badge variant="outline" className="text-[10px] tabular-nums">{matters.length}</Badge>
      </div>
      {matters.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {matters.map((item, index) => (
            <MatterCard
              key={item.matter.matter_id}
              item={item}
              focused={flatOffset + index === focusedIndex}
              onOpen={() => onOpen(item.matter.matter_id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function MatterCard({
  item,
  focused,
  onOpen,
}: {
  item: DraftingHubMatter
  focused: boolean
  onOpen: () => void
}) {
  const matter = item.matter
  const readiness = readinessLabel(item)
  const lastDraft = item.recentDrafts[0]
  const lastActivity = lastDraft?.created_at ?? item.designSheet?.updatedAt ?? matter.matter_created

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-accent hover:bg-muted/40',
        focused ? 'border-accent ring-2 ring-accent/30' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold group-hover:text-accent">{matter.client_name || 'Unnamed client'}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {[item.matterNumber, matter.matter_name || matter.plan_type || 'Matter'].filter(Boolean).join(' · ')} · {stageLabel(matter.stage)}
          </p>
        </div>
        <Badge
          className={cn(
            'shrink-0 border-0 text-[10px]',
            readiness.tone === 'success' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
          )}
        >
          {readiness.label}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <span>{item.includedDocumentLabels.length} docs</span>
        <span>·</span>
        <span>{item.draftCount} draft{item.draftCount === 1 ? '' : 's'}</span>
        {lastDraft && (
          <>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              Last draft {formatDate(lastDraft.created_at)}
            </span>
          </>
        )}
        {!lastDraft && lastActivity && (
          <>
            <span>·</span>
            <span>Updated {formatDate(lastActivity)}</span>
          </>
        )}
      </div>
    </button>
  )
}
