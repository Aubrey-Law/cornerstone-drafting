'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDownAZ, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/SearchField'
import MatterPipelineTable from '@/app/admin/drafting/MatterPipelineTable'
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
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<HubSortKey>('updated')
  const [actionFilter, setActionFilter] = useState<HubActionFilter>('all')
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

  const searched = useMemo(
    () => matters.filter(item => matchesHubSearch(item, search)),
    [matters, search],
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
    if (practiceFilter !== 'all') {
      list = list.filter(item => item.matter.practice_area === practiceFilter)
    }
    return sortHubMatters(list, sortKey)
  }, [actionFilter, practiceFilter, searched, sortKey])

  useEffect(() => {
    setFocusedIndex(i => Math.min(i, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

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
      if (filtered.length === 0) return
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
  }, [filtered, focusedIndex, openMatter])

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
          <div className="mr-1">
            <h1 className="text-xl font-semibold tracking-tight">Drafting</h1>
            <p className="text-[11px] text-muted-foreground">Next actions across active document work</p>
          </div>
          <SearchField
            ref={searchRef}
            value={search}
            onValueChange={setSearch}
            placeholder="Search by client, matter number, email, plan type…"
            aria-label="Search matters"
            containerClassName="max-w-xs min-w-[12rem] flex-1"
          />
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Next action filter">
            {ACTION_CHIPS.map(chip => {
              const selected = actionFilter === chip.value
              return (
                <button
                  key={chip.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActionFilter(chip.value)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
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
          <span className="hidden text-[10px] text-muted-foreground xl:inline">
            ↑↓ navigate · Enter open · / search
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div>
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
              </div>
            </div>
          ) : (
            <MatterPipelineTable
              matters={filtered}
              focusedIndex={focusedIndex}
              onOpen={openMatter}
            />
          )}
        </div>
      </div>
    </div>
  )
}
