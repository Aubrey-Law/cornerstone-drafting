'use client'
import { usePrimaryReady } from '@/app/admin/components/NavigationTiming'

import { useMemo, useRef, useState, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, ChevronRight, Columns3, Database, History, Plus, Table2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  EMPTY_MATTER_TABLE_FILTERS,
  filterAndSortMatters,
  readMatterListView,
  writeMatterListView,
  type MatterListView,
  type MatterSortKey,
  type MatterTableFilters,
} from '@/lib/adminTables/matterTable'
import { STAGE_GROUP_LABELS, STAGE_GROUP_ORDER } from '@/lib/matter/stageGroups'
import { matterExportCsv, matterExportFilename, toMatterExportRow } from '@/lib/matters/exportRows'
import { downloadCsv } from '@/lib/browserDownload'
import { ExportCsvButton } from '@/components/admin/ExportCsvButton'
import { MatterStageBoard, type StageBoardCard } from '@/components/matter/MatterStageBoard'
import {
  MatterPipelineInsights,
  isOpenMatter,
  signingSoon,
  type MatterCardFilter,
} from '@/components/matter/MatterPipelineInsights'
import { isMobileDetailViewport } from '@/components/layout/ResponsiveDetailRail'
import type { MatterPageParams } from '@/lib/matters/pageParams'
import type { MatterPageResult } from '@/lib/queries/matters'
import type { MatterListRow } from '@/lib/queries/matters'
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel, type PracticeAreaCode } from '@/lib/practiceArea'
import {
  formatLastMilestone,
  matterCustomName,
  matterIntakeBadge,
  matterLastMilestoneAt,
  matterMetaFacts,
  matterQuietDays,
  matterSubtitle,
  matterTitle,
} from '@/lib/matters/cardFacts'
import { formatPhoneInput } from '@/lib/phone'
import { GROUP_COLORS, stageInfo, stageLabel, type MatterStage, type StageGroup } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchField } from '@/components/SearchField'
import { FilterChip } from '@/components/FilterChip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RecordWorkIndicator } from '@/components/work/RecordWorkIndicator'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'

const LawmaticsImportDialog = dynamic(() => import('./LawmaticsImportDialog'), { ssr: false })
const ImportExistingMatterDialog = dynamic(() => import('./ImportExistingMatterDialog'), { ssr: false })

interface MattersClientProps {
  matters: MatterListRow[]
  workSummaries?: Record<string, RecordWorkSummary>
  loadError?: string | null
  pagination?: MatterPageResult & {params:MatterPageParams}
}

/** URL spelling of the filters that do not travel under their own name. */
const FILTER_PARAM: Partial<Record<keyof MatterTableFilters, string>> = {
  stageGroup: 'stage',
  includeClosed: 'closed',
}

const INTAKE_BADGE_CLASS: Record<string, string> = {
  submitted: 'border-green/40 bg-green-bg text-green',
  in_progress: 'border-blue-strong-border bg-blue-bg text-blue',
}

export default function MattersClient(props: MattersClientProps) {
  return (
    <Suspense fallback={<MattersClientShell {...props} />}>
      <MattersClientInner {...props} />
    </Suspense>
  )
}

function MattersClientShell({ matters: _matters, loadError = null }: MattersClientProps) {
  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <h1 className="admin-page-title">Matters</h1>
      </div>
      <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
        <p className="text-sm text-muted-foreground">{loadError ?? 'Loading…'}</p>
      </div>
    </div>
  )
}

function MattersClientInner({ matters: initialMatters, workSummaries = {}, loadError = null, pagination }: MattersClientProps) {
  usePrimaryReady('Matters')
  const searchParams = useSearchParams()
  const token = useAccessToken()
  const router = useRouter()
  const searchTimer=useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate=(changes:Record<string,string>,reset=true)=>{
    const next=new URLSearchParams(searchParams.toString())
    if(reset) { next.delete('page'); STAGE_GROUP_ORDER.forEach(group=>next.delete(`page_${group}`)) }
    for(const [key,value] of Object.entries(changes)) { if(value) next.set(key,value); else next.delete(key) }
    router.push(`/admin/matters/list?${next}`,{scroll:false})
  }
  useEffect(()=>()=>{if(searchTimer.current) clearTimeout(searchTimer.current)},[])

  // Held locally so a board drag can move a card before the server confirms;
  // `router.refresh()` re-seeds it through the effect below.
  const [matters, setMatters] = useState(initialMatters)
  const [filters, setFilters] = useState<MatterTableFilters>(pagination?.params.filters ?? EMPTY_MATTER_TABLE_FILTERS)
  const [cardFilter, setCardFilter] = useState<MatterCardFilter | null>(pagination?.params.card ?? null)
  const [sortKey, setSortKey] = useState<MatterSortKey>(pagination?.params.sort ?? 'last_activity')
  const [view, setView] = useState<MatterListView>(pagination?.params.view ?? 'table')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [lawmaticsOpen, setLawmaticsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const createRequestIdRef = useRef<string | null>(null)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [planType, setPlanType] = useState<PracticeAreaCode>('EP')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Hired matters and matters with a signed engagement need the deletion
  // acknowledged; without this the route reports them back as failures and
  // leaves them standing.
  const [deleteHired, setDeleteHired] = useState(false)
  const [sendIntakeOnCreate, setSendIntakeOnCreate] = useState(true)
  const [createdMatterId, setCreatedMatterId] = useState<string | null>(null)
  const [createdIntakeUrl, setCreatedIntakeUrl] = useState<string | null>(null)

  const applySort = (key: MatterSortKey) => {
    setSortKey(key)
    if (pagination) navigate({ sort: key })
  }

  useEffect(() => {
    setMatters(initialMatters)
    if(pagination) { setFilters(pagination.params.filters);setCardFilter(pagination.params.card);setSortKey(pagination.params.sort);setView(pagination.params.view);setSelected({}) }
  }, [initialMatters,pagination])

  const restoredMatterView = useRef(false)
  useEffect(() => {
    if (restoredMatterView.current) return
    restoredMatterView.current = true
    // Below md the five columns are too cramped, so start on the table without
    // overwriting the stored choice — the board stays one tap away.
    if (pagination && searchParams.has('view')) return
    const stored = readMatterListView()
    const preferred = isMobileDetailViewport() && stored === 'board' ? 'table' : stored
    if (pagination && preferred !== pagination.params.view) {
      const query = new URLSearchParams(searchParams.toString())
      query.set('view', preferred)
      router.replace(`/admin/matters/list?${query}`, { scroll: false })
    } else setView(preferred)
  }, [pagination, router, searchParams])

  useEffect(() => {
    if (searchParams.get('create') === '1') setCreateOpen(true)
  }, [searchParams])

  useEffect(() => {
    if (searchParams.get('lm_connected') === '1') {
      toast.success('Lawmatics connected')
      router.replace('/admin/matters')
    }
    const lmError = searchParams.get('lm_error')
    if (lmError) {
      toast.error(`Lawmatics connection failed: ${lmError}`)
      router.replace('/admin/matters')
    }
  }, [router, searchParams])

  const localGroupCounts = useMemo(() => {
    const counts: Record<StageGroup, number> = { early: 0, active: 0, work: 0, done: 0, closed: 0 }
    for (const matter of matters) counts[stageInfo(matter.stage).group] += 1
    return counts
  }, [matters])

  const groupCounts = pagination ? {early:0,active:0,work:0,done:0,closed:0,...pagination.groups} : localGroupCounts

  const hasActiveFilters = useMemo(() => {
    return Boolean(
      filters.search.trim()
      || filters.practice !== 'all'
      || filters.stageGroup !== 'all'
      || filters.includeClosed
      || cardFilter,
    )
  }, [cardFilter, filters])

  // The overview cards narrow the same list the chips and the search box do,
  // so a card is a filter on top of the current view rather than a view of its
  // own — one table, one set of rows, whatever is selected above it.
  const carded = useMemo(() => {
    if (cardFilter === 'attention') return matters.filter(m => isOpenMatter(m) && (workSummaries[m.matter_id]?.attentionCount ?? 0) > 0)
    if (cardFilter === 'signing') return matters.filter(m => isOpenMatter(m) && signingSoon(m))
    return matters
  }, [cardFilter, matters, workSummaries])

  const filtered = useMemo(
    () => pagination ? matters : filterAndSortMatters(carded, filters, sortKey),
    [carded, filters, sortKey, pagination, matters],
  )

  /**
   * Export what is on screen.
   *
   * The list is filtered and sorted in the browser over every open matter the
   * page loaded, so the rows the table is rendering are already the answer —
   * asking the server again would mean restating the search, the chips and the
   * insight cards in SQL, and the two definitions would drift.
   */
  const exportCsv = async () => {
    if(pagination) {
      const params=new URLSearchParams({search:filters.search,practice:filters.practice,stage:filters.stageGroup,sort:sortKey,card:cardFilter ?? '',closed:filters.includeClosed ? '1' : '',format:'json',limit:'2000'})
      const response=await fetch(`/api/admin/matters/export?${params}`,{headers:token ? {Authorization:`Bearer ${token}`} : {}})
      if(!response.ok) throw new Error('Matter export failed')
      const result=await response.json()
      downloadCsv(matterExportCsv(result.matters),matterExportFilename(cardFilter ?? filters.stageGroup))
      if(result.truncated) toast.info(`Exported ${result.matters.length} of ${result.total} matching matters`)
      return
    }
    const label = cardFilter ?? (filters.stageGroup === 'all' ? 'all' : filters.stageGroup)
    downloadCsv(
      matterExportCsv(filtered.map(toMatterExportRow)),
      matterExportFilename(label),
    )
  }

  /** "Open matters" is the unfiltered list, so it clears rather than narrows. */
  const toggleCardFilter = (next: MatterCardFilter) => {
    setSelected({})
    if(pagination) navigate({card:next === 'open' || cardFilter === next ? '' : next})
    if (next === 'open') {
      setCardFilter(null)
      return
    }
    setCardFilter(current => (current === next ? null : next))
  }

  const boardCards = useMemo<StageBoardCard[]>(() => filtered.map(m => ({
    id: m.matter_id,
    stage: m.stage,
    title: matterTitle(m),
    subtitle: matterSubtitle(m),
    badge: matterIntakeBadge(m),
    quietDays: workSummaries[m.matter_id] ? null : matterQuietDays(m),
    href: `/admin/matters/${m.matter_id}`,
    meta: workSummaries[m.matter_id] ? [] : matterMetaFacts(m),
    workSummary: workSummaries[m.matter_id],
  })), [filtered, workSummaries])

  const handleStageChange = (matterId: string, stage: MatterStage) => {
    setMatters(current =>
      current.map(m => (m.matter_id === matterId ? { ...m, stage } : m)),
    )
  }

  const switchView = (next: MatterListView) => {
    setView(next)
    writeMatterListView(next)
    if(pagination) navigate({view:next}, false)
    // Row selection is a table affordance; the board has no checkboxes, so a
    // stale selection would leave an un-clearable bulk bar on screen.
    if (next !== 'table') setSelected({})
  }

  const selectedIds = useMemo(
    () => filtered.filter(m => selected[m.matter_id]).map(m => m.matter_id),
    [filtered, selected],
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selected[m.matter_id])

  const updateFilter = <K extends keyof MatterTableFilters>(key: K, value: MatterTableFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value }))
    if(pagination) {
      if(searchTimer.current) clearTimeout(searchTimer.current)
      // A boolean is a present-or-absent flag in the URL, not the string "false".
      const changes={ [FILTER_PARAM[key] ?? key]: typeof value==='boolean' ? (value ? '1' : '') : value as string }
      if(key==='search') searchTimer.current=setTimeout(()=>navigate(changes),300)
      else navigate(changes)
    }
  }

  const clearFilters = () => {
    setFilters(EMPTY_MATTER_TABLE_FILTERS)
    if(pagination) navigate({search:'',practice:'all',stage:'all',card:'',closed:''})
  }

  const toggleAllFiltered = (checked: boolean) => {
    setSelected(current => {
      const next = { ...current }
      for (const matter of filtered) {
        if (checked) next[matter.matter_id] = true
        else delete next[matter.matter_id]
      }
      return next
    })
  }

  const toggleSelected = (matterId: string, checked: boolean) => {
    setSelected(current => {
      const next = { ...current }
      if (checked) next[matterId] = true
      else delete next[matterId]
      return next
    })
  }

  const resetCreateForm = () => {
    setClientName('')
    setClientEmail('')
    setClientPhone('')
    setPlanType('EP')
    setSendIntakeOnCreate(true)
    setCreatedMatterId(null)
    setCreatedIntakeUrl(null)
  }

  const handleCreate = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    const name = clientName.trim()
    const email = clientEmail.trim()
    if (!name || !email) {
      toast.error('Client name and email are required')
      return
    }

    // Idempotency key for this submission. Held across retries so a double-click
    // or a retry after a lost response resolves to one matter, and cleared on
    // success so a deliberate second matter for the same client still creates one.
    if (!createRequestIdRef.current) {
      createRequestIdRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null
    }

    setCreating(true)
    try {
      const res = await fetch('/api/admin/matters/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientName: name,
          clientEmail: email,
          clientPhone: clientPhone.trim() || null,
          planType,
          requestId: createRequestIdRef.current,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not create matter')
      const matterId = body.matterId as string
      let intakeUrl: string | null = null
      if (sendIntakeOnCreate) {
        const sendRes = await fetch('/api/admin/intake/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ matterId }),
        })
        const sendBody = await sendRes.json().catch(() => ({}))
        if (!sendRes.ok) throw new Error(sendBody.error ?? 'Matter created but intake invite failed')
        if (typeof sendBody.url === 'string') intakeUrl = sendBody.url
      }
      createRequestIdRef.current = null
      setCreatedMatterId(matterId)
      setCreatedIntakeUrl(intakeUrl)
      toast.success(sendIntakeOnCreate ? 'Matter created and intake invite sent' : 'Matter created')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create matter')
    } finally {
      setCreating(false)
    }
  }

  const closeBulkDelete = () => {
    setBulkDeleteOpen(false)
    setDeleteHired(false)
  }

  const handleBulkDelete = async () => {
    if (!token || selectedIds.length === 0) return
    setDeleting(true)
    try {
      const res = await fetch('/api/admin/matters/bulk-delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: selectedIds, confirm: deleteHired }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not delete matters')

      const deleted = typeof body.deleted === 'number' ? body.deleted : selectedIds.length
      const failed = Array.isArray(body.results)
        ? body.results.filter((result: { ok?: boolean }) => !result.ok).length
        : 0

      if (body.requiresConfirmation) {
        // Client matters were skipped rather than lost. Leave the dialog up so
        // the acknowledgement is one click away.
        toast.error(
          `Deleted ${deleted} matter${deleted === 1 ? '' : 's'}; ${failed} hold client records. Confirm below to delete those too.`,
        )
        router.refresh()
        return
      }

      if (failed > 0) {
        toast.error(`Deleted ${deleted} matter${deleted === 1 ? '' : 's'}; ${failed} failed`)
      } else {
        toast.success(`Deleted ${deleted} matter${deleted === 1 ? '' : 's'}`)
      }

      closeBulkDelete()
      setSelected({})
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete matters')
    } finally {
      setDeleting(false)
    }
  }

  const emptyMessage = loadError
    ? `Could not load matters: ${loadError}`
    : (pagination ? Object.values(pagination.groups).reduce((sum,n)=>sum+(n ?? 0),0) === 0 : matters.length === 0)
      ? 'No matters yet. Create one to get started.'
      : hasActiveFilters
        ? 'No matters match the current filters.'
        : 'No matters to show.'

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <div className="space-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-2 admin-page-title">Matters</h1>
          <SearchField
            value={filters.search}
            onValueChange={value => updateFilter('search', value)}
            placeholder="Search all fields…"
            aria-label="Search matters"
            containerClassName="max-w-md min-w-[14rem] flex-1"
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ExportCsvButton
              disabled={filtered.length === 0}
              title="Download the matters currently listed as a CSV"
              onExport={exportCsv}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setLawmaticsOpen(true)}>
              <Database className="h-3.5 w-3.5" />
              Import from Lawmatics
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <History className="h-3.5 w-3.5" />
              Existing matter
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              New matter
            </Button>
          </div>
        </div>
        <MatterPipelineInsights
          matters={matters}
          totals={pagination?.insights}
          activeFilter={cardFilter}
          onToggleFilter={toggleCardFilter}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip
            onClick={() => updateFilter('stageGroup', 'all')}
            selected={filters.stageGroup === 'all'}
            count={Object.values(groupCounts).reduce((sum,n)=>sum+n,0)}
          >
            All
          </FilterChip>
          {STAGE_GROUP_ORDER.map(group => (
            <FilterChip
              key={group}
              onClick={() => updateFilter('stageGroup', filters.stageGroup === group ? 'all' : group)}
              selected={filters.stageGroup === group}
              count={groupCounts[group]}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: GROUP_COLORS[group].dot }}
              />
              {STAGE_GROUP_LABELS[group]}
            </FilterChip>
          ))}
          {/*
            Closed matters are out of the list by default — finished work with
            nothing waiting on it — and this is the way back to one.
          */}
          <FilterChip
            onClick={() => updateFilter('includeClosed', !filters.includeClosed)}
            selected={filters.includeClosed}
          >
            Include closed
          </FilterChip>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label="View mode"
            >
              <button type="button" aria-pressed={view === 'grid'} onClick={() => switchView('grid')} className={cn('rounded px-2.5 py-1 text-xs font-medium', view === 'grid' && 'bg-selected text-selected-foreground ring-1 ring-inset ring-selected-border')}>Grid</button>
              <button
                type="button"
                aria-pressed={view === 'board'}
                onClick={() => switchView('board')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  view === 'board' ? 'bg-selected text-selected-foreground ring-1 ring-inset ring-selected-border' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Columns3 className="h-3.5 w-3.5" aria-hidden />
                Board
              </button>
              <button
                type="button"
                aria-pressed={view === 'table'}
                onClick={() => switchView('table')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  view === 'table' ? 'bg-selected text-selected-foreground ring-1 ring-inset ring-selected-border' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Table2 className="h-3.5 w-3.5" aria-hidden />
                Table
              </button>
            </div>
            <Select
              value={filters.practice}
              onValueChange={value => updateFilter('practice', value)}
            >
              <SelectTrigger size="sm" className="w-40" aria-label="Filter by practice area">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Practice · All</SelectItem>
                {PRACTICE_AREA_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={value => applySort(value as MatterSortKey)}>
              <SelectTrigger size="sm" className="w-40" aria-label="Sort matters by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_activity">Last activity</SelectItem>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="client_asc">Client A-Z</SelectItem>
                <SelectItem value="client_desc">Client Z-A</SelectItem>
                <SelectItem value="matter_number">Matter number</SelectItem>
                <SelectItem value="matter_number_desc">Matter number (high-low)</SelectItem>
                <SelectItem value="last_activity_oldest">Least recent activity</SelectItem>
                <SelectItem value="practice_asc">Practice A-Z</SelectItem>
                <SelectItem value="practice_desc">Practice Z-A</SelectItem>
                <SelectItem value="stage_asc">Stage (early first)</SelectItem>
                <SelectItem value="stage_desc">Stage (late first)</SelectItem>
                <SelectItem value="intake_asc">Intake A-Z</SelectItem>
                <SelectItem value="intake_desc">Intake Z-A</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {selectedIds.length} selected
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected({})}>
              Clear selection
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
        {pagination && <div className="mb-3 flex items-center gap-3 text-sm"><span>{pagination.total} matching matters{view!=='board' ? ` · page ${pagination.page}` : ''}</span>{view!=='board' && <><Button variant="outline" size="sm" disabled={pagination.page<=1} onClick={()=>navigate({page:String(pagination.page-1)},false)}>Previous</Button><Button variant="outline" size="sm" disabled={pagination.page*pagination.pageSize>=pagination.total} onClick={()=>navigate({page:String(pagination.page+1)},false)}>Next</Button></>}</div>}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-6 py-16 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {!loadError && matters.length === 0 && (
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New matter
              </Button>
            )}
          </div>
        ) : view === 'grid' ? (
          <ul aria-label="Matters grid" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(m => <li key={m.matter_id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-2"><Link href={`/admin/matters/${m.matter_id}`} className="font-semibold hover:underline">{matterTitle(m)}</Link><Badge variant="secondary">{stageLabel(m.stage)}</Badge></div>
              <p className="text-xs text-muted-foreground">{matterSubtitle(m)}</p>
              <RecordWorkIndicator summary={workSummaries[m.matter_id]} />
              <p className="text-xs text-muted-foreground">Last milestone · {formatLastMilestone(matterLastMilestoneAt(m))}</p>
            </li>)}
          </ul>
        ) : view === 'board' ? (
          <MatterStageBoard
            cards={boardCards}
            onOpen={matterId => router.push(`/admin/matters/${matterId}`)}
            onStageChange={handleStageChange}
            pagination={pagination ? Object.fromEntries(STAGE_GROUP_ORDER.map(group=>[group,{total:pagination.columns[group] ?? 0,page:Math.max(1,Math.min(pagination.params.groupPages[group],Math.ceil((pagination.columns[group] ?? 0)/pagination.pageSize))),pageSize:pagination.pageSize}])) : undefined}
            onPageChange={(group,page)=>navigate({[`page_${group}`]:String(page)},false)}
            onSaved={()=>{navigate({});router.refresh()}}
            label="Matters pipeline board"
          />
        ) : (
          <>
          {/*
            Below md the eight-column table only fits by scrolling sideways,
            which leaves the client and practice area on screen and pushes the
            stage and the next action out of view. Phones get the same rows as
            a stacked list instead; bulk selection stays a desktop affordance.
          */}
          <ul aria-label="Matters" className="divide-y divide-border rounded-lg border border-border bg-card md:hidden">
            {filtered.map(m => {
              const groupColor = GROUP_COLORS[stageInfo(m.stage).group]
              const subtitle = matterSubtitle(m)
              return (
                // The whole row opens the matter through the title link's
                // overlay; the work indicator carries links of its own, so it
                // sits above that overlay rather than inside a second <a>.
                <li key={m.matter_id} className="relative space-y-1.5 px-3 py-3 hover:bg-accent">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/matters/${m.matter_id}`}
                        className="block truncate text-sm font-medium text-foreground after:absolute after:inset-0"
                      >
                        {matterTitle(m)}
                      </Link>
                      {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
                    </div>
                    <span
                      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-medium"
                      style={{ background: groupColor.bg, color: groupColor.text }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: groupColor.dot }} />
                      {stageLabel(m.stage)}
                    </span>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="relative z-10 min-w-0">
                      <RecordWorkIndicator summary={workSummaries[m.matter_id]} />
                    </div>
                    <span className="shrink-0 text-micro text-muted-foreground">
                      {formatLastMilestone(matterLastMilestoneAt(m))}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="hidden rounded-lg border border-border bg-card md:block">
            <Table className="min-w-[56rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={checked => toggleAllFiltered(checked === true)}
                      aria-label="Select all visible matters"
                    />
                  </TableHead>
                  <SortableHead label="Matter #" asc="matter_number" desc="matter_number_desc" sortKey={sortKey} onSort={applySort} />
                  <SortableHead label="Client" asc="client_asc" desc="client_desc" sortKey={sortKey} onSort={applySort} />
                  <SortableHead label="Practice Area" asc="practice_asc" desc="practice_desc" sortKey={sortKey} onSort={applySort} />
                  <SortableHead label="Stage" asc="stage_asc" desc="stage_desc" sortKey={sortKey} onSort={applySort} />
                  <SortableHead label="Intake" asc="intake_asc" desc="intake_desc" sortKey={sortKey} onSort={applySort} />
                  <SortableHead label="Last activity" asc="last_activity_oldest" desc="last_activity" sortKey={sortKey} onSort={applySort} />
                  <TableHead>Attention</TableHead>
                  <TableHead className="w-10" aria-label="Open matter" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => {
                  const group = stageInfo(m.stage).group
                  const groupColor = GROUP_COLORS[group]
                  const activity = matterLastMilestoneAt(m)
                  const customName = matterCustomName(m)
                  return (
                    <TableRow key={m.matter_id}>
                      <TableCell>
                        <Checkbox
                          checked={Boolean(selected[m.matter_id])}
                          onCheckedChange={checked => toggleSelected(m.matter_id, checked === true)}
                          aria-label={`Select matter for ${m.client_name || 'client'}`}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {m.matter_number || '—'}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/matters/${m.matter_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {matterTitle(m)}
                        </Link>
                        {customName && (
                          <span className="block text-xs text-muted-foreground">{customName}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {practiceAreaLabel(m.practice_area)}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-medium"
                          style={{ background: groupColor.bg, color: groupColor.text }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: groupColor.dot }}
                          />
                          {stageLabel(m.stage)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-micro capitalize ${
                            INTAKE_BADGE_CLASS[m.intake_status ?? ''] ?? 'text-muted-foreground'
                          }`}
                        >
                          {matterIntakeBadge(m).label}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatLastMilestone(activity)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <RecordWorkIndicator summary={workSummaries[m.matter_id]} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/admin/matters/${m.matter_id}`}
                          className="inline-flex rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={`Open matter for ${m.client_name || 'client'}`}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          </>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={open => {
          setCreateOpen(open)
          if (!open) resetCreateForm()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdMatterId ? 'Matter ready' : 'Create Matter'}</DialogTitle>
            <DialogDescription>
              {createdMatterId
                ? 'The matter is created. Copy the intake link or open the matter detail page.'
                : 'Start a new estate planning matter with client contact details.'}
            </DialogDescription>
          </DialogHeader>
          {createdMatterId ? (
            <div className="grid gap-3 py-1">
              {createdIntakeUrl && (
                <div className="grid gap-1.5">
                  <Label htmlFor="created-intake-url">Intake link</Label>
                  <div className="flex gap-2">
                    <Input id="created-intake-url" readOnly value={createdIntakeUrl} />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(createdIntakeUrl)
                        toast.success('Intake link copied')
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div className="grid gap-3 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="create-client-name">Client name</Label>
              <Input
                id="create-client-name"
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                placeholder="Jane Doe"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-client-email">Client email</Label>
              <Input
                id="create-client-email"
                type="email"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-client-phone">Phone (optional)</Label>
              <Input
                id="create-client-phone"
                type="tel"
                value={clientPhone}
                onChange={e => setClientPhone(formatPhoneInput(e.target.value))}
                placeholder="(555) 555-5555"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Practice area</Label>
              <Select value={planType} onValueChange={v => setPlanType(v as PracticeAreaCode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRACTICE_AREA_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sendIntakeOnCreate}
                onCheckedChange={checked => setSendIntakeOnCreate(checked === true)}
              />
              Send intake invite email
            </label>
          </div>
          )}
          <DialogFooter>
            {createdMatterId ? (
              <>
                <Button type="button" variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm() }}>
                  Close
                </Button>
                <Button type="button" asChild>
                  <Link href={`/admin/matters/${createdMatterId}`}>Open matter</Link>
                </Button>
              </>
            ) : (
              <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating…' : sendIntakeOnCreate ? 'Create & send intake' : 'Create'}
            </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={open => !open && closeBulkDelete()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.length} matter{selectedIds.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the selected matters, including intake, documents, design sheets, and messages.
              This cannot be undone. Closing or archiving a matter keeps all of it.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
            <Checkbox
              checked={deleteHired}
              onCheckedChange={checked => setDeleteHired(checked === true)}
              aria-label="Include hired matters and matters with a signed engagement"
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              Also delete hired matters and matters with a signed engagement. Without this they are
              skipped.
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeBulkDelete} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleBulkDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : `Delete ${selectedIds.length} matter${selectedIds.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LawmaticsImportDialog open={lawmaticsOpen} onOpenChange={setLawmaticsOpen} />
      <ImportExistingMatterDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}

function SortableHead({ label, asc, desc, sortKey, onSort }: {
  label: string
  asc: MatterSortKey
  desc: MatterSortKey
  sortKey: MatterSortKey
  onSort: (key: MatterSortKey) => void
}) {
  const active = sortKey === asc || sortKey === desc
  const Icon = !active ? ArrowUpDown : sortKey === asc ? ArrowUp : ArrowDown
  return (
    <TableHead aria-sort={!active ? 'none' : sortKey === asc ? 'ascending' : 'descending'}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(sortKey === asc ? desc : asc)}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? '' : 'opacity-40'}`} aria-hidden />
      </button>
    </TableHead>
  )
}
