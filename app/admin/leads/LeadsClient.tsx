'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Columns3, Plus, Table2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'
import type { LeadProgressFilter, LeadSortKey } from '@/lib/adminTables/leadTable'
import {
  LEAD_PAGE_SIZE,
  MAX_LEAD_PAGE_SIZE,
  type LeadListParams,
  type LeadListSummary,
} from '@/lib/leads/listParams'
import { SendEngagementDialog } from './SendEngagementDialog'
import LawmaticsImportDialog from '../matters/LawmaticsImportDialog'
import {
  LeadPipelineInsights,
  type LeadCardFilter,
} from '@/components/leads/LeadPipelineInsights'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/SearchField'
import { PageHeader } from '@/components/PageHeader'
import { FilterChip } from '@/components/FilterChip'
import type { LeadListRow, LeadSpouseRecord, MutableLeadStatus } from '@/lib/leads/viewTypes'
import { computeLeadScore, leadScoreInputFromRow, type LeadScore } from '@/lib/leads/score'
import { LeadSidePanel } from '@/components/leads/LeadSidePanel'
import { apiRequest } from '@/lib/clientApi'
import { LeadsTable, leadListName as leadName } from '@/components/leads/LeadsTable'
import { LeadsBoard } from '@/components/leads/LeadsBoard'
import { groupLeadsByBoardColumn, LEAD_BOARD_COLUMNS } from '@/lib/leads/board'
import { cn } from '@/lib/utils'
import { LeadEditorDialog, type LeadEditorForm } from '@/components/leads/LeadEditorDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type LeadRow = LeadListRow

/**
 * A lead carrying its computed score. The score is derived at render rather
 * than stored: it moves every time the lead is touched, so a persisted copy
 * would be stale before it was read.
 */
export type ScoredLeadRow = LeadRow & { score: number; scoreDetail: LeadScore }

type LeadFilter = LeadListParams['status']
type LeadView = 'table' | 'board'

const FILTER_TABS: { value: LeadFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'lost', label: 'Lost' },
  // A fit that never engaged (lost) and one the firm turned away (declined) are
  // separate outcomes, and only the first belongs in a conversion rate.
  { value: 'declined', label: 'Declined' },
  { value: 'all', label: 'All' },
]

const LEAD_PROGRESS_OPTIONS: { value: LeadProgressFilter; label: string }[] = [
  { value: 'all', label: 'Progress · All' },
  { value: 'intake_not_sent', label: 'Intake not sent' },
  { value: 'intake_pending', label: 'Intake pending' },
  { value: 'intake_complete', label: 'Intake complete' },
  { value: 'engagement_pending', label: 'Engagement pending' },
  { value: 'engagement_signed', label: 'Engagement signed' },
]

const LEAD_SORT_OPTIONS: { value: LeadSortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name_asc', label: 'Name A-Z' },
  { value: 'name_desc', label: 'Name Z-A' },
  { value: 'fee_desc', label: 'Highest fee' },
  { value: 'last_activity', label: 'Last activity' },
  { value: 'score_desc', label: 'Lead score' },
]

export function LeadsClient({
  initialLeads,
  params,
  total,
  hasMore,
  summary,
  spouses = {},
  esignEnabled,
}: {
  /** One page of the server's ordering — already filtered, sorted and ranked. */
  initialLeads: LeadRow[]
  params: LeadListParams
  total: number
  hasMore: boolean
  summary: LeadListSummary
  spouses?: Record<string, LeadSpouseRecord>
  esignEnabled: boolean
}) {
  const token = useAccessToken()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [form, setForm] = useState<LeadEditorForm>({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '' })
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LeadRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [signingUrl, setSigningUrl] = useState<string | null>(null)
  const [engagementLead, setEngagementLead] = useState<LeadRow | null>(null)
  const [lawmaticsOpen, setLawmaticsOpen] = useState(false)

  useEffect(() => {
    if (searchParams?.get('create') === '1') setDialogOpen(true)
  }, [searchParams])

  /**
   * The rows arrive filtered, sorted and ranked by the server, so the only
   * work left here is the score breakdown the cards and the panel render. The
   * number itself came from `lead_score()` and the two agree — see
   * tests/lead-score-sql-parity.test.ts — but the reasons live in TypeScript.
   */
  const filteredLeads = useMemo(
    () => initialLeads.map(lead => {
      const scoreDetail = computeLeadScore(leadScoreInputFromRow(lead))
      return { ...lead, score: scoreDetail.score, scoreDetail }
    }),
    [initialLeads],
  )

  const [openMenuLeadId, setOpenMenuLeadId] = useState<string | null>(null)
  // Selection lives in the URL so the panel survives a refresh; local state
  // mirrors it so a click opens the panel without a router round trip.
  const urlLeadId = searchParams?.get('lead') ?? null
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(urlLeadId)
  useEffect(() => { setSelectedLeadId(urlLeadId) }, [urlLeadId])
  const selectedLead = useMemo(
    () => filteredLeads.find(lead => lead.id === selectedLeadId) ?? null,
    [filteredLeads, selectedLeadId],
  )

  const writeParams = useCallback((changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams?.toString() ?? '')
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const qs = next.toString()
    // A transition so the current rows stay on screen — and readable — while
    // the server re-runs the query behind them.
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : (pathname ?? ''), { scroll: false })
    })
  }, [pathname, router, searchParams])

  const writeParam = useCallback(
    (key: string, value: string | null) => writeParams({ [key]: value }),
    [writeParams],
  )

  /**
   * Any change to what is being asked for resets the page back to the first
   * one. Without this, narrowing a 300-row list would keep asking for 300 rows
   * of a set that now holds twelve.
   */
  const writeQuery = useCallback(
    (changes: Record<string, string | null>) => writeParams({ ...changes, show: null }),
    [writeParams],
  )

  const filter: LeadFilter = params.status
  const cardFilter: LeadCardFilter | null = params.card
  const sortKey: LeadSortKey = params.sort

  const setFilter = useCallback((next: LeadFilter) => {
    writeQuery({ status: next === 'open' ? null : next })
  }, [writeQuery])

  // The search box types faster than the server can answer, so the field holds
  // its own value and the URL follows a beat later.
  const [searchDraft, setSearchDraft] = useState(params.search)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { setSearchDraft(params.search) }, [params.search])
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current) }, [])
  const onSearchChange = useCallback((value: string) => {
    setSearchDraft(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => writeQuery({ q: value.trim() || null }), 300)
  }, [writeQuery])

  const loadMore = useCallback(() => {
    writeParams({ show: String(initialLeads.length + LEAD_PAGE_SIZE) })
  }, [initialLeads.length, writeParams])

  /**
   * One request has a ceiling, so past it the answer is a narrower question
   * rather than a bigger page. Saying so is the point of the whole change: the
   * old list stopped at 200 and said nothing.
   */
  const atRequestCeiling = initialLeads.length >= MAX_LEAD_PAGE_SIZE

  const selectLead = useCallback((leadId: string | null) => {
    setSelectedLeadId(leadId)
    writeParam('lead', leadId)
  }, [writeParam])

  // The view lives in the URL alongside the selection so a refresh or a shared
  // link lands on the same board or table.
  const urlView: LeadView = searchParams?.get('view') === 'board' ? 'board' : 'table'
  const [view, setView] = useState<LeadView>(urlView)
  useEffect(() => { setView(urlView) }, [urlView])
  const selectView = useCallback((next: LeadView) => {
    setView(next)
    // Only the table can show or change a selection, so it does not travel.
    setSelected({})
    writeParam('view', next === 'board' ? 'board' : null)
  }, [writeParam])

  const openFullRecord = useCallback(() => {
    if (selectedLeadId) router.push(`/admin/crm/opportunities/${selectedLeadId}`)
  }, [router, selectedLeadId])

  /** Arrow keys walk the reading order, which the board groups by column. */
  const navigationOrder = useMemo(() => {
    if (view !== 'board') return filteredLeads
    const grouped = groupLeadsByBoardColumn(filteredLeads)
    return LEAD_BOARD_COLUMNS.flatMap(column => grouped.get(column.key) ?? [])
  }, [filteredLeads, view])

  useEffect(() => {
    if (!selectedLead) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const target = event.target
      if (target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      const index = navigationOrder.findIndex(lead => lead.id === selectedLead!.id)
      if (index === -1) return
      const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1
      const next = navigationOrder[nextIndex]
      if (!next) return
      event.preventDefault()
      selectLead(next.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigationOrder, selectLead, selectedLead])

  const hasTableFilters = Boolean(
    params.search.trim() || params.practice !== 'all' || params.progress !== 'all',
  )

  const clearTableFilters = () => {
    setSearchDraft('')
    writeQuery({ q: null, practice: null, progress: null })
  }

  /** Cards narrow the current tab; "Open leads" just resets to the Open tab. */
  const toggleCardFilter = (next: LeadCardFilter) => {
    if (next === 'open') {
      writeQuery({ card: null, status: null })
      return
    }
    writeQuery({ card: cardFilter === next ? null : next, status: null })
  }
  // Counted over the whole pipeline by the server, so a tab reports what it
  // would show rather than how much of it is currently loaded.
  const counts: Record<LeadFilter, number> = {
    open: summary.open,
    lost: summary.lost,
    declined: summary.declined,
    all: summary.all,
  }

  const selectedIds = useMemo(
    () => filteredLeads.filter(l => selected[l.id]).map(l => l.id),
    [filteredLeads, selected],
  )
  const allSelected = filteredLeads.length > 0 && filteredLeads.every(l => selected[l.id])

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected(current => {
      const next = { ...current }
      if (checked) next[id] = true
      else delete next[id]
      return next
    })
  }
  const toggleAll = (checked: boolean) => {
    setSelected(current => {
      const next = { ...current }
      for (const lead of filteredLeads) {
        if (checked) next[lead.id] = true
        else delete next[lead.id]
      }
      return next
    })
  }

  async function authedPost(path: string, body?: unknown): Promise<Record<string, unknown>> {
    if (!token) throw new Error('Not signed in')
    return apiRequest<Record<string, unknown>>(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }

  const openCreate = () => {
    setForm({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '' })
    setDialogOpen(true)
  }
  /** Editing happens in the record panel, which patches one validated field at a time. */
  const openEdit = (lead: LeadRow) => selectLead(lead.id)

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required')
      return
    }
    setSaving(true)
    try {
      const fee = form.fee.trim()
      const payload: Record<string, unknown> = {
        clientName: form.name.trim(),
        clientEmail: form.email.trim(),
        clientPhone: form.phone.trim() || undefined,
        practiceArea: form.practiceArea,
        feeQuoted: fee === '' ? null : Number(fee),
      }
      await authedPost('/api/admin/leads', payload)
      toast.success('Lead added')
      setDialogOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save lead')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLead = async () => {
    if (!token || !deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/leads/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Could not delete lead')
      toast.success('Lead deleted')
      setDeleteTarget(null)
      setSelected(current => {
        const next = { ...current }
        delete next[deleteTarget.id]
        return next
      })
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete lead')
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!token || selectedIds.length === 0) return
    setDeleting(true)
    try {
      const res = await fetch('/api/admin/leads/bulk-delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        deleted?: number
        results?: { ok?: boolean }[]
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not delete leads')
      const deleted = typeof body.deleted === 'number' ? body.deleted : selectedIds.length
      const failed = Array.isArray(body.results) ? body.results.filter(r => !r.ok).length : 0
      if (failed > 0) toast.error(`Deleted ${deleted} lead${deleted === 1 ? '' : 's'}; ${failed} failed`)
      else toast.success(`Deleted ${deleted} lead${deleted === 1 ? '' : 's'}`)
      setBulkDeleteOpen(false)
      setSelected({})
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete leads')
    } finally {
      setDeleting(false)
    }
  }

  const handleSendIntake = async (lead: LeadRow) => {
    setBusyLeadId(lead.id)
    try {
      await authedPost('/api/admin/intake/send', { intakeId: lead.id })
      toast.success(`Intake sent to ${lead.email}`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send intake')
    } finally {
      setBusyLeadId(null)
    }
  }

  /** Board drops onto Lost / New flip the opportunity status in place. */
  const handleStatusChange = async (lead: LeadRow, status: MutableLeadStatus) => {
    setBusyLeadId(lead.id)
    try {
      const res = await fetch(`/api/admin/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Could not update lead')
      toast.success(
        status === 'lost' ? 'Lead marked lost'
        : status === 'declined' ? 'Lead declined'
        : 'Lead reopened',
      )
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update lead')
    } finally {
      setBusyLeadId(null)
    }
  }

  const closeSigning = () => {
    setSigningUrl(null)
    // The webhook converts the lead → matter on completion; refresh to reflect it.
    router.refresh()
  }

  const [convertTarget, setConvertTarget] = useState<LeadRow | null>(null)

  const handleConvert = async (lead: LeadRow) => {
    setBusyLeadId(lead.id)
    try {
      const result = await authedPost(`/api/admin/leads/${lead.id}/convert`)
      toast.success('Matter created')
      if (typeof result.matterId === 'string') {
        router.push(`/admin/matters/${result.matterId}`)
      } else {
        router.refresh()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create matter')
      setBusyLeadId(null)
    }
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Opportunities"
        description="Prospective and historical client opportunities — manage intake, engagement, follow-up, and conversion from one pipeline."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setLawmaticsOpen(true)}>
              Import from Lawmatics
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New lead
            </Button>
          </>
        }
      />

      <LeadPipelineInsights
        totals={summary}
        activeFilter={cardFilter}
        onToggleFilter={toggleCardFilter}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map(tab => (
            <FilterChip
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              selected={filter === tab.value}
              count={counts[tab.value]}
            >
              {tab.label}
            </FilterChip>
          ))}
        </div>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
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
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={searchDraft}
          onValueChange={onSearchChange}
          placeholder="Search leads…"
          aria-label="Search leads"
          containerClassName="min-w-52 flex-1 bg-card"
        />
        <Select
          value={params.practice}
          onValueChange={value => writeQuery({ practice: value === 'all' ? null : value })}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Filter leads by practice area">
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
        <Select
          value={params.progress}
          onValueChange={value => writeQuery({ progress: value === 'all' ? null : value })}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Filter leads by progress">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEAD_PROGRESS_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={sortKey}
            onValueChange={value => writeQuery({ sort: value === 'newest' ? null : value })}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Sort leads by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEAD_SORT_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className="inline-flex rounded-md border border-border bg-background p-0.5"
            role="group"
            aria-label="View mode"
          >
            <button
              type="button"
              aria-pressed={view === 'table'}
              onClick={() => selectView('table')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Table2 className="h-3.5 w-3.5" aria-hidden />
              Table
            </button>
            <button
              type="button"
              aria-pressed={view === 'board'}
              onClick={() => selectView('board')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                view === 'board' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Columns3 className="h-3.5 w-3.5" aria-hidden />
              Board
            </button>
          </div>
          {hasTableFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearTableFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {view === 'board' && (
        <p className="text-[11px] text-muted-foreground">
          Drag a card onto a column to run that step — Intake sent emails the intake, Engagement opens
          the send form, Hired creates the matter, and Lost closes the lead out.
        </p>
      )}

      <div className="flex items-start gap-3">
        <div className={cn('min-w-0 flex-1 space-y-3', pending && 'opacity-60 transition-opacity')}>
          {view === 'board' ? (
            <LeadsBoard
              leads={filteredLeads}
              hasAnyLeads={initialLeads.length > 0}
              busyLeadId={busyLeadId}
              esignEnabled={esignEnabled}
              activeLeadId={selectedLead?.id ?? null}
              onActivate={lead => selectLead(lead.id)}
              openMenuLeadId={openMenuLeadId}
              onMenuOpenChange={(leadId, open) => setOpenMenuLeadId(open ? leadId : null)}
              onEdit={openEdit}
              onStatusChange={(lead, status) => void handleStatusChange(lead, status)}
              onSendIntake={lead => void handleSendIntake(lead)}
              onSendEngagement={setEngagementLead}
              onHire={setConvertTarget}
              onArchive={setDeleteTarget}
              onMarkLost={lead => void handleStatusChange(lead, 'lost')}
              onMarkDeclined={lead => void handleStatusChange(lead, 'declined')}
              onReopen={lead => void handleStatusChange(lead, 'lead')}
            />
          ) : (
            <LeadsTable
              leads={filteredLeads}
              hasAnyLeads={initialLeads.length > 0}
              selected={selected}
              allSelected={allSelected}
              busyLeadId={busyLeadId}
              esignEnabled={esignEnabled}
              activeLeadId={selectedLead?.id ?? null}
              onActivate={lead => selectLead(lead.id)}
              openMenuLeadId={openMenuLeadId}
              onMenuOpenChange={(leadId, open) => setOpenMenuLeadId(open ? leadId : null)}
              onToggleAll={toggleAll}
              onToggleSelected={toggleSelected}
              onEdit={openEdit}
              onStatusChange={(lead, status) => void handleStatusChange(lead, status)}
              onSendIntake={lead => void handleSendIntake(lead)}
              onSendEngagement={setEngagementLead}
              onHire={setConvertTarget}
              onArchive={setDeleteTarget}
            />
          )}
          {/*
            The list is a page of the server's ordering, so it has to say so.
            The old list truncated at 200 silently, which meant a ranked
            subset read exactly like the whole pipeline.
          */}
          {total > 0 && (
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-muted-foreground" aria-live="polite">
                Showing {filteredLeads.length} of {total} {total === 1 ? 'lead' : 'leads'}
                {hasTableFilters || cardFilter ? ' matching these filters' : ''}
                {sortKey === 'score_desc' ? ' — highest score first' : ''}
              </p>
              {hasMore && (atRequestCeiling ? (
                <span className="text-[11px] text-muted-foreground">
                  Search or filter to reach the rest
                </span>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={pending}>
                  {pending ? 'Loading…' : `Load ${Math.min(LEAD_PAGE_SIZE, total - filteredLeads.length)} more`}
                </Button>
              ))}
            </div>
          )}
        </div>
        {selectedLead && (
          <LeadSidePanel
            key={selectedLead.id}
            lead={selectedLead}
            spouse={spouses[selectedLead.id] ?? null}
            onClose={() => selectLead(null)}
            onOpenFullRecord={openFullRecord}
            onOpenRowMenu={() => setOpenMenuLeadId(selectedLead.id)}
            onLeadSaved={() => router.refresh()}
          />
        )}
      </div>

      <LeadEditorDialog
        open={dialogOpen}
        form={form}
        saving={saving}
        onOpenChange={setDialogOpen}
        onFormChange={setForm}
        onSave={() => void handleSave()}
      />
      <LawmaticsImportDialog open={lawmaticsOpen} onOpenChange={setLawmaticsOpen} defaultTarget="lead" />

      <Dialog open={deleteTarget !== null} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive lead?</DialogTitle>
            <DialogDescription>
              This removes {deleteTarget ? leadName(deleteTarget) : 'this lead'} from active lead work while retaining
              its intake and history. A pending engagement signature request is cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteLead()} disabled={deleting}>
              {deleting ? 'Archiving…' : 'Archive lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={open => !open && setBulkDeleteOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Archive {selectedIds.length} lead{selectedIds.length === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogDescription>
              This removes the selected leads from active work while retaining their intake and history.
              Pending engagement signature requests are cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleBulkDelete()} disabled={deleting}>
              {deleting ? 'Archiving…' : `Archive ${selectedIds.length} lead${selectedIds.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SendEngagementDialog
        lead={engagementLead}
        onOpenChange={open => !open && setEngagementLead(null)}
        onSent={() => router.refresh()}
        onSignNow={link => setSigningUrl(link)}
      />

      <Dialog open={signingUrl !== null} onOpenChange={open => !open && closeSigning()}>
        <DialogContent className="h-[85vh] max-w-4xl p-0 sm:max-w-4xl">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Sign engagement agreement</DialogTitle>
            <DialogDescription>
              Have the client sign here. The matter is created automatically once they finish — close
              this window when they&apos;re done.
            </DialogDescription>
          </DialogHeader>
          {signingUrl && (
            <iframe
              src={signingUrl}
              title="Engagement agreement signing"
              className="h-full w-full flex-1 rounded-b-lg border-0"
              allow="camera; microphone; clipboard-write"
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={convertTarget !== null} onOpenChange={open => !open && setConvertTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hire this client?</AlertDialogTitle>
            <AlertDialogDescription>
              Create a matter for {convertTarget ? leadName(convertTarget) : 'this lead'} now. The lead
              becomes an active matter and moves into the drafting pipeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const lead = convertTarget
                setConvertTarget(null)
                if (lead) void handleConvert(lead)
              }}
            >
              Create matter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
