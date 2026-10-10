'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownAZ, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterChip } from '@/components/FilterChip'
import { SearchField } from '@/components/SearchField'
import MatterPipelineTable from '@/app/admin/drafting/MatterPipelineTable'
import { SavedDraftingViews } from './SavedDraftingViews'
import { HUB_RETURN_KEY, hubPageUrl, parseHubPage, type HubView, type HubPageQuery } from '@/lib/drafting/hubView'
import { cn } from '@/lib/utils'
import {
  type HubActionFilter,
  type HubSortKey,
  QUIET_DAYS,
} from '@/lib/drafting/hubUtils'
import type { DraftingHubPage } from '@/lib/drafting/hub'

interface DraftingHubClientProps {
  result: DraftingHubPage
  query: HubPageQuery
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

export default function DraftingHubClient({ result, query }: DraftingHubClientProps) {
  const router = useRouter()
  const { matters, error: loadError, actionCounts, practiceCounts, total, page, pageSize } = result
  const [pending, startTransition] = useTransition()
  const params = useSearchParams()
  const queryKey = params.toString()
  const [view, setView] = useState<HubPageQuery>(query)
  const { search, sort: sortKey, action: actionFilter, practice: practiceFilter } = view
  const [focusedIndex, setFocusedIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const worklistRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  const positionRef = useRef({ matterId: '', scrollTop: 0 })
  const initialized = useRef(false)
  const restorePosition = useRef(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // An older response must not erase text typed during the next debounce.
    if (searchTimer.current) return
    let next = query
    if (!initialized.current) {
      initialized.current = true
      try {
        const saved = JSON.parse(sessionStorage.getItem(HUB_RETURN_KEY) ?? 'null')
        if (saved && typeof saved.url === 'string' && saved.url.startsWith('/admin/drafting?')) {
          if (!queryKey) {
            next = parseHubPage(new URLSearchParams(saved.url.split('?')[1]))
            startTransition(() => router.replace(hubPageUrl(next), { scroll: false }))
          }
          if (!queryKey || saved.url === hubPageUrl(next)) {
            positionRef.current = { matterId: typeof saved.matterId === 'string' ? saved.matterId : '', scrollTop: Number.isFinite(saved.scrollTop) ? Math.max(0, saved.scrollTop) : 0 }
            restorePosition.current = true
          }
        }
      } catch { /* Returning to the list also works without session storage. */ }
    }
    if (queryKey && !loadError && parseHubPage(new URLSearchParams(queryKey)).page !== next.page) {
      startTransition(() => router.replace(hubPageUrl(next), { scroll: false }))
    }
    viewRef.current = next
    setView(current => hubPageUrl(current) === hubPageUrl(next) ? current : next)
  }, [queryKey, query, router, loadError])

  const rememberPosition = useCallback(() => {
    try { sessionStorage.setItem(HUB_RETURN_KEY, JSON.stringify({ url: hubPageUrl(viewRef.current), ...positionRef.current })) } catch { /* optional convenience */ }
  }, [])

  const updateView = (nextView: HubView, nextPage = 1) => {
    const next = { ...nextView, page: nextPage }
    viewRef.current = next
    positionRef.current = { matterId: '', scrollTop: 0 }
    if (worklistRef.current) worklistRef.current.scrollTop = 0
    setView(next)
    setFocusedIndex(0)
    startTransition(() => router.replace(hubPageUrl(next), { scroll: false }))
    rememberPosition()
  }
  // Debounce only search; chips, saved views and pagination navigate immediately.
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
  const cancelSearch = () => { if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = null }
  const setSearch = (value: string) => {
    cancelSearch()
    const next = { ...viewRef.current, search: value, page: 1 }
    viewRef.current = next
    setView(next)
    searchTimer.current = setTimeout(() => { searchTimer.current = null; updateView(next) }, 250)
  }
  const applyView = (next: HubView, nextPage = 1) => { cancelSearch(); updateView(next, nextPage) }
  const setSortKey = (value: HubSortKey) => applyView({ ...view, sort: value })
  const setActionFilter = (value: HubActionFilter) => applyView({ ...view, action: value })
  const setPracticeFilter = (value: string) => applyView({ ...view, practice: value })
  const filtered = matters

  useEffect(() => {
    if (restorePosition.current && hubPageUrl(query) !== hubPageUrl(viewRef.current)) return
    if (restorePosition.current && worklistRef.current) {
      restorePosition.current = false
      const index = filtered.findIndex(item => item.matter.matter_id === positionRef.current.matterId)
      if (index >= 0) setFocusedIndex(index)
      worklistRef.current.scrollTop = positionRef.current.scrollTop
    } else setFocusedIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)))
  }, [filtered, query])

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
    : search.trim() || actionFilter !== 'all' || practiceFilter !== 'all'
      ? 'No drafting work matches the current filters.'
      : 'No matters currently need drafting work.'

  const showRetry = Boolean(loadError)

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 w-full sm:w-auto">
            <h1 className="text-xl font-semibold tracking-tight">Drafting</h1>
            <p className="text-micro text-muted-foreground">Next actions across active document work</p>
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
                <FilterChip
                  key={chip.value}
                  selected={selected}
                  count={actionCounts[chip.value]}
                  onClick={() => setActionFilter(chip.value)}
                  className={cn('shrink-0 text-micro', !selected && chip.tone)}
                >
                  {chip.label}
                </FilterChip>
              )
            })}
          </div>
          <label className="flex items-center gap-1.5 text-micro text-muted-foreground">
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
          {(practiceCounts.length > 0 || practiceFilter !== 'all') && (
            <select
              value={practiceFilter}
              onChange={e => setPracticeFilter(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
              aria-label="Practice area"
            >
              <option value="all">All areas</option>
              {practiceFilter !== 'all' && !practiceCounts.some(area => area.name === practiceFilter) && <option value={practiceFilter}>{practiceFilter} · 0</option>}
              {practiceCounts.map(area => (
                <option key={area.name} value={area.name}>{area.name} · {area.count}</option>
              ))}
            </select>
          )}
          <SavedDraftingViews view={{ search, sort: sortKey, action: actionFilter, practice: practiceFilter }} onChange={applyView} />
          <span className="hidden text-micro text-muted-foreground xl:inline">
            ↑↓ navigate · Enter open · / search
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground md:px-6">
        <span role="status" aria-live="polite">{pending ? 'Loading worklist…' : `${total === 0 ? 0 : (page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} matters`}</span>
        <nav aria-label="Worklist pages" className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pending || page <= 1} onClick={() => applyView(view, page - 1)}>Previous</Button>
          <span>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <Button variant="outline" size="sm" disabled={pending || page * pageSize >= total} onClick={() => applyView(view, page + 1)}>Next</Button>
        </nav>
      </div>
      <div ref={worklistRef} aria-busy={pending} role="region" aria-label="Drafting worklist" onScroll={event => { positionRef.current.scrollTop = event.currentTarget.scrollTop; rememberPosition() }} className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
        <div>
          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {!showRetry && (search || actionFilter !== 'all' || practiceFilter !== 'all') && (
                  <Button variant="outline" size="sm" onClick={() => applyView({ search: '', sort: 'updated', action: 'all', practice: 'all' })}>Clear filters</Button>
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
