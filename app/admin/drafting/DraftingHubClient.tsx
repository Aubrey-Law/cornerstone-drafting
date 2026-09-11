'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownAZ, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/SearchField'
import MatterPipelineTable from '@/app/admin/drafting/MatterPipelineTable'
import { SavedDraftingViews } from './SavedDraftingViews'
import { HUB_RETURN_KEY, hubViewUrl, parseHubView, type HubView } from '@/lib/drafting/hubView'
import { cn } from '@/lib/utils'
import {
  type HubActionFilter,
  type HubSortKey,
  QUIET_DAYS,
  hubNextActionKey,
  isHubQuiet,
  matchesHubSearch,
  sortHubMatters,
} from '@/lib/drafting/hubUtils'
import type { DraftingHubMatter } from '@/lib/queries/drafting'

interface DraftingHubClientProps {
  matters: DraftingHubMatter[]
  loadError?: string | null
}

/** Next-action chips, in toolbar order. `tone` styles the unselected pill. */
const ACTION_CHIPS: { value: HubActionFilter; label: string; tone: string }[] = [
  { value: 'all', label: 'All', tone: 'bg-muted text-muted-foreground' },
  { value: 'design', label: 'Design', tone: 'bg-amber-bg text-amber' },
  { value: 'setup', label: 'Setup', tone: 'bg-amber-bg text-amber' },
  { value: 'generate', label: 'Generate', tone: 'bg-green-bg text-green' },
  { value: 'review', label: 'Review', tone: 'bg-blue-bg text-blue' },
  { value: 'revise', label: 'Revise', tone: 'bg-amber-bg text-amber' },
  { value: 'quiet', label: `Quiet ${QUIET_DAYS}d+`, tone: 'bg-red-bg text-red' },
]

export default function DraftingHubClient({ matters: initialMatters, loadError = null }: DraftingHubClientProps) {
  const router = useRouter()
  const matters = initialMatters
  const params = useSearchParams()
  const queryKey = params.toString()
  const [view, setView] = useState<HubView>(() => parseHubView(new URLSearchParams(queryKey)))
  const { search, sort: sortKey, action: actionFilter, practice: practiceFilter } = view
  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const worklistRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  const positionRef = useRef({ matterId: '', scrollTop: 0 })
  const initialized = useRef(false)
  const restorePosition = useRef(false)

  useEffect(() => {
    let next = parseHubView(new URLSearchParams(queryKey))
    if (!initialized.current) {
      initialized.current = true
      try {
        const saved = JSON.parse(sessionStorage.getItem(HUB_RETURN_KEY) ?? 'null')
        if (saved && typeof saved.url === 'string' && saved.url.startsWith('/admin/drafting?')) {
          if (!queryKey) {
            next = parseHubView(new URLSearchParams(saved.url.split('?')[1]))
            window.history.replaceState(null, '', hubViewUrl(next))
          }
          if (!queryKey || saved.url === hubViewUrl(next)) {
            positionRef.current = { matterId: typeof saved.matterId === 'string' ? saved.matterId : '', scrollTop: Number.isFinite(saved.scrollTop) ? Math.max(0, saved.scrollTop) : 0 }
            restorePosition.current = true
          }
        }
      } catch { /* Returning to the list also works without session storage. */ }
    }
    viewRef.current = next
    setView(current => hubViewUrl(current) === hubViewUrl(next) ? current : next)
  }, [queryKey])

  const rememberPosition = useCallback(() => {
    try { sessionStorage.setItem(HUB_RETURN_KEY, JSON.stringify({ url: hubViewUrl(viewRef.current), ...positionRef.current })) } catch { /* optional convenience */ }
  }, [])

  const updateView = (next: HubView) => {
    viewRef.current = next
    positionRef.current = { matterId: '', scrollTop: 0 }
    if (worklistRef.current) worklistRef.current.scrollTop = 0
    setView(next)
    setFocusedIndex(0)
    // Native history integrates with App Router without fetching unchanged data.
    window.history.replaceState(null, '', hubViewUrl(next))
    rememberPosition()
  }
  const setSearch = (value: string) => updateView({ ...view, search: value })
  const setSortKey = (value: HubSortKey) => updateView({ ...view, sort: value })
  const setActionFilter = (value: HubActionFilter) => updateView({ ...view, action: value })
  const setPracticeFilter = (value: string) => updateView({ ...view, practice: value })

  const practiceAreas = useMemo(() => {
    const set = new Set<string>()
    for (const item of matters) {
      const area = item.matter.practice_area?.trim()
      if (area) set.add(area)
    }
    return Array.from(set).sort()
  }, [matters])

  const searched = useMemo(
    () => matters.filter(item => matchesHubSearch(item, search) && (practiceFilter === 'all' || item.matter.practice_area === practiceFilter)),
    [matters, search, practiceFilter],
  )

  const actionCounts = useMemo(() => {
    const counts: Record<HubActionFilter, number> = {
      all: searched.length,
      design: 0,
      setup: 0,
      generate: 0,
      review: 0,
      revise: 0,
      quiet: 0,
    }
    for (const item of searched) {
      counts[hubNextActionKey(item)] += 1
      if (isHubQuiet(item)) counts.quiet += 1
    }
    return counts
  }, [searched])

  const filtered = useMemo(() => {
    let list = searched
    if (actionFilter === 'quiet') {
      list = list.filter(isHubQuiet)
    } else if (actionFilter !== 'all') {
      list = list.filter(item => hubNextActionKey(item) === actionFilter)
    }
    return sortHubMatters(list, sortKey)
  }, [actionFilter, searched, sortKey])

  useEffect(() => {
    if (restorePosition.current && hubViewUrl(view) !== hubViewUrl(viewRef.current)) return
    if (restorePosition.current && worklistRef.current) {
      restorePosition.current = false
      const index = filtered.findIndex(item => item.matter.matter_id === positionRef.current.matterId)
      if (index >= 0) setFocusedIndex(index)
      worklistRef.current.scrollTop = positionRef.current.scrollTop
    } else setFocusedIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)))
  }, [filtered, view])

  const focusRow = (index: number) => {
    setFocusedIndex(index)
    positionRef.current.matterId = filtered[index]?.matter.matter_id ?? ''
    rememberPosition()
  }
  const openMatter = (matterId: string) => {
    positionRef.current.matterId = matterId
    rememberPosition()
    router.push(`/admin/drafting/${matterId}`)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || target.closest('[role="dialog"], [role="menu"]')) return
      const editable = target.closest('input, select, textarea, [contenteditable="true"]')
      if (editable) return
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (!worklistRef.current?.contains(target) || event.metaKey || event.ctrlKey || event.altKey) return
      const row = target.closest<HTMLElement>('[data-drafting-row-index]')
      if (!row || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
      event.preventDefault()
      const next = Math.max(0, Math.min(filtered.length - 1, Number(row.dataset.draftingRowIndex) + (event.key === 'ArrowDown' ? 1 : -1)))
      // Keep navigation on the same responsive surface, including in tests with no layout.
      const surface = target.closest('table, [role="list"]')
      surface?.querySelector<HTMLElement>(`[data-drafting-row-index="${next}"]`)?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filtered.length])

  const emptyMessage = loadError
    ? `Could not load matters: ${loadError}`
    : matters.length === 0
      ? 'No matters currently need drafting work.'
      : search.trim() || actionFilter !== 'all' || practiceFilter !== 'all'
        ? 'No drafting work matches the current filters.'
        : 'No drafting work to show.'

  const showRetry = Boolean(loadError)

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 w-full sm:w-auto">
            <h1 className="text-xl font-semibold tracking-tight">Drafting</h1>
            <p className="text-[11px] text-muted-foreground">Next actions across active document work</p>
          </div>
          <SearchField
            ref={searchRef}
            value={search}
            onValueChange={setSearch}
            placeholder="Search by client, matter number, email, plan type…"
            aria-label="Search matters"
            containerClassName="w-full sm:max-w-xs sm:min-w-[12rem] sm:flex-1"
          />
          <div
            className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
            role="group"
            aria-label="Next action filter"
          >
            {ACTION_CHIPS.map(chip => {
              const selected = actionFilter === chip.value
              return (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActionFilter(chip.value)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    selected ? 'bg-primary text-primary-foreground' : cn(chip.tone, 'hover:opacity-80'),
                  )}
                >
                  {chip.label}
                  <span className="tabular-nums opacity-70">· {actionCounts[chip.value]}</span>
                </button>
              )
            })}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ArrowDownAZ className="h-3 w-3" aria-hidden />
            <span className="sr-only">Sort</span>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as HubSortKey)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              aria-label="Sort matters"
            >
              <option value="updated">Last activity</option>
              <option value="client">Client name</option>
              <option value="action">Next action</option>
            </select>
          </label>
          {practiceAreas.length > 1 && (
            <select
              value={practiceFilter}
              onChange={e => setPracticeFilter(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              aria-label="Practice area"
            >
              <option value="all">All areas</option>
              {practiceAreas.map(area => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          )}
          <SavedDraftingViews view={view} onChange={updateView} />
          <span className="hidden text-[10px] text-muted-foreground xl:inline">
            ↑↓ navigate · Enter open · / search
          </span>
        </div>
      </div>

      <div ref={worklistRef} role="region" aria-label="Drafting worklist" onScroll={event => { positionRef.current.scrollTop = event.currentTarget.scrollTop; rememberPosition() }} className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
        <div>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {!showRetry && (search || actionFilter !== 'all' || practiceFilter !== 'all') && (
                  <Button variant="outline" size="sm" onClick={() => updateView({ search: '', sort: 'updated', action: 'all', practice: 'all' })}>Clear filters</Button>
                )}
                {showRetry && (
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => router.refresh()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <MatterPipelineTable
              matters={filtered}
              focusedIndex={focusedIndex}
              onFocusIndex={focusRow}
              onOpen={openMatter}
            />
          )}
        </div>
      </div>
    </div>
  )
}
