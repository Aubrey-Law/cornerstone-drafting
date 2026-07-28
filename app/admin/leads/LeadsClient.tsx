'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { normalizePracticeArea, PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'
import {
  EMPTY_LEAD_TABLE_FILTERS,
  filterAndSortLeads,
  type LeadSortKey,
  type LeadTableFilters,
} from '@/lib/adminTables/leadTable'
import { SendEngagementDialog } from './SendEngagementDialog'
import LawmaticsImportDialog from '../matters/LawmaticsImportDialog'
import {
  hasPendingAgreement,
  isOpenLead,
  LeadPipelineInsights,
  needsAttention,
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
import type { LeadListRow } from '@/lib/leads/viewTypes'
import { apiRequest } from '@/lib/clientApi'
import { LeadsTable, leadListName as leadName } from '@/components/leads/LeadsTable'
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

type LeadFilter = 'open' | 'lost' | 'all'

const FILTER_TABS: { value: LeadFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'lost', label: 'Lost' },
  { value: 'all', label: 'All' },
]

const LEAD_PROGRESS_OPTIONS: { value: LeadTableFilters['progress']; label: string }[] = [
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
]

function matchesFilter(lead: LeadRow, filter: LeadFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return (lead.lead_status ?? 'lead') === 'lead'
  return lead.lead_status === filter
}

export function LeadsClient({
  initialLeads,
  esignEnabled,
}: {
  initialLeads: LeadRow[]
  esignEnabled: boolean
}) {
  const token = useAccessToken()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingLead, setEditingLead] = useState<LeadRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null)
  const [form, setForm] = useState<LeadEditorForm>({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '', status: 'lead' })
  const [filter, setFilter] = useState<LeadFilter>('open')
  const [cardFilter, setCardFilter] = useState<LeadCardFilter | null>(null)
  const [tableFilters, setTableFilters] = useState<LeadTableFilters>(EMPTY_LEAD_TABLE_FILTERS)
  const [sortKey, setSortKey] = useState<LeadSortKey>('newest')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LeadRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [signingUrl, setSigningUrl] = useState<string | null>(null)
  const [engagementLead, setEngagementLead] = useState<LeadRow | null>(null)
  const [lawmaticsOpen, setLawmaticsOpen] = useState(false)

  const baseLeads = useMemo(
    () =>
      initialLeads.filter(l => {
        if (!matchesFilter(l, filter)) return false
        if (cardFilter === 'attention') return isOpenLead(l) && needsAttention(l)
        if (cardFilter === 'agreements') return isOpenLead(l) && hasPendingAgreement(l)
        return true
      }),
    [initialLeads, filter, cardFilter],
  )

  const filteredLeads = useMemo(
    () => filterAndSortLeads(baseLeads, tableFilters, sortKey),
    [baseLeads, tableFilters, sortKey],
  )

  const hasTableFilters = Boolean(
    tableFilters.search.trim()
    || tableFilters.practice !== 'all'
    || tableFilters.progress !== 'all',
  )

  const clearTableFilters = () => setTableFilters(EMPTY_LEAD_TABLE_FILTERS)

  /** Cards narrow the current tab; "Open leads" just resets to the Open tab. */
  const toggleCardFilter = (next: LeadCardFilter) => {
    if (next === 'open') {
      setCardFilter(null)
      setFilter('open')
      return
    }
    setCardFilter(current => (current === next ? null : next))
    setFilter('open')
  }
  const counts = useMemo(() => {
    const c: Record<LeadFilter, number> = { open: 0, lost: 0, all: initialLeads.length }
    for (const l of initialLeads) {
      const s = l.lead_status ?? 'lead'
      if (s === 'lead') c.open += 1
      else if (s === 'lost') c.lost += 1
    }
    return c
  }, [initialLeads])

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
    setEditingLead(null)
    setForm({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '', status: 'lead' })
    setDialogOpen(true)
  }
  const openEdit = (lead: LeadRow) => {
    setEditingLead(lead)
    setForm({
      name: leadName(lead) === lead.email ? '' : leadName(lead),
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      practiceArea: normalizePracticeArea(lead.practice_area),
      fee: lead.engagement_fee_quoted != null ? String(lead.engagement_fee_quoted) : '',
      status: lead.lead_status ?? 'lead',
    })
    setDialogOpen(true)
  }

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
      if (editingLead) {
        payload.leadStatus = form.status
        const res = await fetch(`/api/admin/leads/${editingLead.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Could not save lead')
        toast.success('Lead updated')
      } else {
        await authedPost('/api/admin/leads', payload)
        toast.success('Lead added')
      }
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
        title="Leads"
        description="Prospective matters before hiring — send the intake and engagement agreement from here. Signing promotes the existing opportunity to a hired matter."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setLawmaticsOpen(true)}>
              Import from Lawmatics
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Create lead matter
            </Button>
          </>
        }
      />

      <LeadPipelineInsights
        leads={initialLeads}
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
          value={tableFilters.search}
          onValueChange={value => setTableFilters(current => ({ ...current, search: value }))}
          placeholder="Search leads…"
          aria-label="Search leads"
          containerClassName="min-w-52 flex-1 bg-card"
        />
        <Select
          value={tableFilters.practice}
          onValueChange={value => setTableFilters(current => ({ ...current, practice: value }))}
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
          value={tableFilters.progress}
          onValueChange={value => setTableFilters(current => ({
            ...current,
            progress: value as LeadTableFilters['progress'],
          }))}
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
          <Select value={sortKey} onValueChange={value => setSortKey(value as LeadSortKey)}>
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
          {hasTableFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearTableFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <LeadsTable
        leads={filteredLeads}
        hasAnyLeads={initialLeads.length > 0}
        selected={selected}
        allSelected={allSelected}
        busyLeadId={busyLeadId}
        esignEnabled={esignEnabled}
        onToggleAll={toggleAll}
        onToggleSelected={toggleSelected}
        onEdit={openEdit}
        onSendIntake={lead => void handleSendIntake(lead)}
        onSendEngagement={setEngagementLead}
        onHire={setConvertTarget}
        onArchive={setDeleteTarget}
      />

      <LeadEditorDialog
        open={dialogOpen}
        editingLead={editingLead}
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
