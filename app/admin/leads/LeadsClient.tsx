'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreVertical, Plus, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { normalizePracticeArea, PRACTICE_AREA_OPTIONS, practiceAreaLabel, practiceAreaMatterCode } from '@/lib/practiceArea'
import { clientNameMatterSlug } from '@/lib/matterNumber'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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

export interface LeadRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  practice_area: string | null
  status: string | null
  lead_status: string | null
  matter_id: string | null
  intake_sent_at: string | null
  intake_completed_at: string | null
  engagement_status: string | null
  engagement_sent_at: string | null
  engagement_signed_at: string | null
  engagement_fee_quoted: number | null
  created_at: string | null
  updated_at: string | null
  lead_urgency: string | null
  taxable_estate: number | null
  last_activity_at: string | null
}

type LeadFilter = 'open' | 'lost' | 'all'

const LEAD_STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'lost', label: 'Lost' },
] as const

const FILTER_TABS: { value: LeadFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'lost', label: 'Lost' },
  { value: 'all', label: 'All' },
]

function matchesFilter(lead: LeadRow, filter: LeadFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return (lead.lead_status ?? 'lead') === 'lead'
  return lead.lead_status === filter
}

function leadName(lead: LeadRow): string {
  return (
    lead.full_name?.trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    lead.email ||
    'Lead'
  )
}

/** Provisional lead number, e.g. 2026-EP-Smith; becomes 2026-EP-Smith-001 on conversion. */
function provisionalNumber(lead: LeadRow): string {
  const year = lead.created_at ? new Date(lead.created_at).getFullYear() : new Date().getFullYear()
  const code = practiceAreaMatterCode(lead.practice_area)
  const slug = clientNameMatterSlug(leadName(lead))
  return `${year}-${code}-${slug}`
}

function intakeDone(lead: LeadRow): boolean {
  return Boolean(lead.intake_completed_at) || lead.status === 'completed'
}

type NextStep =
  | { key: 'send_intake'; label: string; primary: true }
  | { key: 'remind_intake'; label: string; primary: false }
  | { key: 'send_engagement'; label: string; primary: true }
  | { key: 'resend_engagement'; label: string; primary: false }
  | { key: 'view_matter'; label: string; primary: false }
  | { key: 'hire_matter'; label: string; primary: false }

/** The single action a lead is waiting on, derived from its intake/engagement state. */
function nextStep(lead: LeadRow, esignEnabled: boolean): NextStep {
  if (lead.lead_status === 'hired' && lead.matter_id) {
    return { key: 'view_matter', label: 'View matter', primary: false }
  }
  if (!lead.intake_sent_at && !intakeDone(lead)) {
    return { key: 'send_intake', label: 'Send intake', primary: true }
  }
  if (!intakeDone(lead)) {
    return { key: 'remind_intake', label: 'Remind client', primary: false }
  }
  if (esignEnabled && lead.engagement_status !== 'signed') {
    if (!lead.engagement_sent_at) {
      return { key: 'send_engagement', label: 'Send engagement', primary: true }
    }
    return { key: 'resend_engagement', label: 'Resend engagement', primary: false }
  }
  return { key: 'hire_matter', label: 'Hire matter', primary: false }
}

type StepState = 'done' | 'pending' | 'todo'

/** Whole days since an ISO timestamp, for the "sent 6d" sub-label. */
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000))
}

function intakeStep(lead: LeadRow): { state: StepState; label: string } {
  if (intakeDone(lead)) return { state: 'done', label: 'Intake' }
  if (lead.intake_sent_at) {
    return { state: 'pending', label: `Intake · sent ${daysSince(lead.intake_sent_at)}d` }
  }
  return { state: 'todo', label: 'Intake' }
}

function engagementStep(lead: LeadRow): { state: StepState; label: string } {
  if (lead.engagement_status === 'signed') return { state: 'done', label: 'Engagement' }
  if (lead.engagement_status === 'declined') return { state: 'pending', label: 'Engagement · declined' }
  if (lead.engagement_sent_at) {
    return { state: 'pending', label: `Engagement · sent ${daysSince(lead.engagement_sent_at)}d` }
  }
  return { state: 'todo', label: 'Engagement' }
}

const STEP_DOT: Record<StepState, string> = {
  done: 'bg-green border-green',
  pending: 'bg-amber-orange border-amber-orange',
  todo: 'border-border-strong bg-transparent',
}

const STEP_TEXT: Record<StepState, string> = {
  done: 'text-green',
  pending: 'text-amber',
  todo: 'text-muted-foreground',
}

function Step({ state, label }: { state: StepState; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${STEP_TEXT[state]}`}>
      <span className={`h-2 w-2 rounded-full border-[1.5px] ${STEP_DOT[state]}`} />
      {label}
    </span>
  )
}

function LeadProgress({ lead }: { lead: LeadRow }) {
  const intake = intakeStep(lead)
  const engagement = engagementStep(lead)
  const hired: StepState = lead.lead_status === 'hired' ? 'done' : 'todo'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px]">
      <Step state={intake.state} label={intake.label} />
      <span className="h-px w-3 bg-border" />
      <Step state={engagement.state} label={engagement.label} />
      <span className="h-px w-3 bg-border" />
      <Step state={hired} label="Hired" />
    </span>
  )
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
  const [form, setForm] = useState({ name: '', email: '', phone: '', practiceArea: 'EP', fee: '', status: 'lead' })
  const [filter, setFilter] = useState<LeadFilter>('open')
  const [cardFilter, setCardFilter] = useState<LeadCardFilter | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LeadRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [signingUrl, setSigningUrl] = useState<string | null>(null)
  const [engagementLead, setEngagementLead] = useState<LeadRow | null>(null)
  const [lawmaticsOpen, setLawmaticsOpen] = useState(false)

  const filteredLeads = useMemo(
    () =>
      initialLeads.filter(l => {
        if (!matchesFilter(l, filter)) return false
        if (cardFilter === 'attention') return isOpenLead(l) && needsAttention(l)
        if (cardFilter === 'agreements') return isOpenLead(l) && hasPendingAgreement(l)
        return true
      }),
    [initialLeads, filter, cardFilter],
  )

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
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Request failed')
    return json
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Prospective matters before hiring — send the intake and engagement agreement from here.
            Signing promotes the existing opportunity to a hired matter.
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <Button size="sm" variant="outline" onClick={() => setLawmaticsOpen(true)}>
            Import from Lawmatics
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Create lead matter
          </Button>
        </div>
      </div>

      <LeadPipelineInsights
        leads={initialLeads}
        activeFilter={cardFilter}
        onToggleFilter={toggleCardFilter}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === tab.value
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label} ({counts[tab.value]})
            </button>
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

      {filteredLeads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-12 text-center">
          <UserPlus className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            {initialLeads.length === 0
              ? 'No leads yet. Add one to send the intake and engagement agreement.'
              : 'No leads in this view.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={checked => toggleAll(checked === true)}
                    aria-label="Select all leads"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Practice</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">Next step</TableHead>
                <TableHead className="w-10" aria-label="More actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLeads.map(lead => {
                const busy = busyLeadId === lead.id
                const step = nextStep(lead, esignEnabled)
                const hired = lead.lead_status === 'hired'
                const runStep = () => {
                  switch (step.key) {
                    case 'send_intake':
                    case 'remind_intake':
                      void handleSendIntake(lead)
                      return
                    case 'send_engagement':
                    case 'resend_engagement':
                      setEngagementLead(lead)
                      return
                    default:
                      setConvertTarget(lead)
                  }
                }
                return (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <Checkbox
                        checked={Boolean(selected[lead.id])}
                        onCheckedChange={checked => toggleSelected(lead.id, checked === true)}
                        aria-label={`Select ${leadName(lead)}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/admin/leads/${lead.id}`} className="hover:underline">{leadName(lead)}</Link>
                      <div className="text-[11px] font-normal text-muted-foreground">
                        {provisionalNumber(lead)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lead.email}</TableCell>
                    <TableCell>{practiceAreaLabel(lead.practice_area)}</TableCell>
                    <TableCell>
                      {lead.engagement_fee_quoted != null
                        ? `$${lead.engagement_fee_quoted.toLocaleString('en-US')}`
                        : '—'}
                    </TableCell>
                    <TableCell><LeadProgress lead={lead} /></TableCell>
                    <TableCell className="text-right">
                      {step.key === 'view_matter' && lead.matter_id ? (
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                          <Link href={`/admin/matters/${lead.matter_id}`}>{step.label}</Link>
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={step.primary ? 'default' : 'outline'}
                          className="h-7 px-2.5 text-xs"
                          disabled={busy}
                          onClick={runStep}
                        >
                          {step.label}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            disabled={busy}
                            aria-label={`More actions for ${leadName(lead)}`}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => openEdit(lead)}>Edit</DropdownMenuItem>
                          {!hired && (
                            <DropdownMenuItem onSelect={() => void handleSendIntake(lead)}>
                              {lead.intake_sent_at ? 'Resend intake' : 'Send intake'}
                            </DropdownMenuItem>
                          )}
                          {!hired && esignEnabled && lead.engagement_status !== 'signed' && (
                            <DropdownMenuItem onSelect={() => setEngagementLead(lead)}>
                              {lead.engagement_sent_at ? 'Resend engagement' : 'Send engagement'}
                            </DropdownMenuItem>
                          )}
                          {!hired && (
                            <DropdownMenuItem onSelect={() => setConvertTarget(lead)}>
                              Hire matter
                            </DropdownMenuItem>
                          )}
                          {!hired && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleteTarget(lead)}
                              >
                                Archive lead
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingLead ? 'Edit lead' : 'New lead'}</DialogTitle>
            <DialogDescription>
              A prospective matter becomes Hired when the engagement agreement is signed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Client name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
            <Input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
            <Input
              placeholder="Phone (optional)"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            />
            <Select
              value={form.practiceArea}
              onValueChange={value => setForm(f => ({ ...f, practiceArea: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRACTICE_AREA_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editingLead && (
              <Select
                value={form.status}
                onValueChange={value => setForm(f => ({ ...f, status: value }))}
              >
                <SelectTrigger aria-label="Matter status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUS_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input
              type="number"
              min={0}
              step="0.01"
              placeholder="Quoted flat fee (optional)"
              value={form.fee}
              onChange={e => setForm(f => ({ ...f, fee: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : editingLead ? 'Save changes' : 'Add lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
