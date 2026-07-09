'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownAZ, Columns3, RefreshCw, Search, Table2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MatterPipelineKanban from '@/app/admin/drafting/MatterPipelineKanban'
import MatterPipelineTable from '@/app/admin/drafting/MatterPipelineTable'
import { cn } from '@/lib/utils'
import {
  type DraftingHubView,
  type HubReadinessFilter,
  type HubSortKey,
  hubReadinessBucket,
  matchesHubSearch,
  readDraftingHubView,
  sortHubMatters,
  writeDraftingHubView,
} from '@/lib/drafting/hubUtils'
import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { MatterStage } from '@/types/database'

interface DraftingHubClientProps {
  matters: DraftingHubMatter[]
  loadError?: string | null
}

export default function DraftingHubClient({ matters: initialMatters, loadError = null }: DraftingHubClientProps) {
  const router = useRouter()
  const [matters, setMatters] = useState(initialMatters)
  const [view, setView] = useState<DraftingHubView>('kanban')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<HubSortKey>('updated')
  const [readinessFilter, setReadinessFilter] = useState<HubReadinessFilter>('all')
  const [practiceFilter, setPracticeFilter] = useState<string>('all')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMatters(initialMatters)
  }, [initialMatters])

  useEffect(() => {
    setView(readDraftingHubView())
  }, [])

  const practiceAreas = useMemo(() => {
    const set = new Set<string>()
    for (const item of matters) {
      const area = item.matter.practice_area?.trim()
      if (area) set.add(area)
    }
    return Array.from(set).sort()
  }, [matters])

  const filtered = useMemo(() => {
    let list = matters.filter(item => matchesHubSearch(item, search))
    if (readinessFilter !== 'all') {
      list = list.filter(item => hubReadinessBucket(item) === readinessFilter)
    }
    if (practiceFilter !== 'all') {
      list = list.filter(item => item.matter.practice_area === practiceFilter)
    }
    return sortHubMatters(list, sortKey)
  }, [matters, practiceFilter, readinessFilter, search, sortKey])

  useEffect(() => {
    setFocusedIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  const openMatter = useCallback((matterId: string) => {
    router.push(`/admin/drafting/${matterId}`)
  }, [router])

  const handleStageChange = useCallback((matterId: string, stage: MatterStage) => {
    setMatters(current =>
      current.map(item =>
        item.matter.matter_id === matterId
          ? { ...item, matter: { ...item.matter, stage } }
          : item,
      ),
    )
  }, [])

  const switchView = useCallback((next: DraftingHubView) => {
    setView(next)
    writeDraftingHubView(next)
  }, [])

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
      if (view !== 'table' || filtered.length === 0) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setFocusedIndex(i => Math.min(i + 1, filtered.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusedIndex(i => Math.max(i - 1, 0))
      } else if (event.key === 'Enter') {
        const item = filtered[focusedIndex]
        if (item) openMatter(item.matter.matter_id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filtered, focusedIndex, openMatter, view])

  const emptyMessage = loadError
    ? `Could not load matters: ${loadError}`
    : matters.length === 0
      ? 'No open matters yet. Create a matter to start drafting.'
      : search.trim() || readinessFilter !== 'all' || practiceFilter !== 'all'
        ? 'No matters match the current filters.'
        : 'No matters to show.'

  const hasActiveFilters = Boolean(search.trim() || readinessFilter !== 'all' || practiceFilter !== 'all')
  const showCreateCta = !loadError && matters.length === 0 && !hasActiveFilters
  const showRetry = Boolean(loadError)

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Drafting</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a matter to open its drafting workspace — drag cards between stages or use the table to update pipeline status.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex max-w-md min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:border-accent">
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
          <div className="inline-flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="View mode">
            <button
              type="button"
              onClick={() => switchView('kanban')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'kanban' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Columns3 className="h-3.5 w-3.5" aria-hidden />
              Kanban
            </button>
            <button
              type="button"
              onClick={() => switchView('table')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              Table
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ArrowDownAZ className="h-3 w-3" aria-hidden />
            Sort
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as HubSortKey)}
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
              onChange={e => setReadinessFilter(e.target.value as HubReadinessFilter)}
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
          <span className="text-[10px] text-muted-foreground">
            {view === 'table' ? '↑↓ navigate · Enter open · / search' : 'Drag cards to change stage · / search'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className={cn(view === 'kanban' ? 'max-w-none' : 'mx-auto max-w-6xl')}>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {showRetry && (
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => router.refresh()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
                {showCreateCta && (
                  <Button type="button" size="sm" asChild>
                    <Link href="/admin/matters?create=1">Create matter</Link>
                  </Button>
                )}
              </div>
            </div>
          ) : view === 'kanban' ? (
            <MatterPipelineKanban
              matters={filtered}
              onOpen={openMatter}
              onStageChange={handleStageChange}
            />
          ) : (
            <MatterPipelineTable
              matters={filtered}
              focusedIndex={focusedIndex}
              onOpen={openMatter}
              onStageChange={handleStageChange}
            />
          )}
        </div>
      </div>
    </div>
  )
}
