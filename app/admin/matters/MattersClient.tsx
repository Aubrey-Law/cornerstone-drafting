'use client'

import { useMemo, useState, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Briefcase, Database, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import type { MatterListRow } from '@/lib/queries/matters'
import { formatUnreviewedUploadDetail, formatUnreviewedUploadLabel, mergeUnreviewedCounts } from '@/lib/matter/unreviewedUploads'
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel, type PracticeAreaCode } from '@/lib/practiceArea'
import { STAGES, stageLabel } from '@/types/database'
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

const LawmaticsImportDialog = dynamic(() => import('./LawmaticsImportDialog'), { ssr: false })

interface MattersClientProps {
  matters: MatterListRow[]
  loadError?: string | null
}

type MatterFilters = {
  practice: string
  stage: string
  intake: string
}

const EMPTY_FILTERS: MatterFilters = {
  practice: 'all',
  stage: 'all',
  intake: 'all',
}

function intakeStatusLabel(status: string | null | undefined) {
  return status?.replace(/_/g, ' ') || '—'
}

export default function MattersClient(props: MattersClientProps) {
  return (
    <Suspense fallback={<MattersClientShell {...props} />}>
      <MattersClientInner {...props} />
    </Suspense>
  )
}

function MattersClientShell({ matters, loadError = null }: MattersClientProps) {
  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Matters</h1>
      </div>
      <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
        <p className="text-sm text-muted-foreground">{loadError ?? 'Loading…'}</p>
      </div>
    </div>
  )
}

function MattersClientInner({ matters, loadError = null }: MattersClientProps) {
  const searchParams = useSearchParams()
  const token = useAccessToken()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<MatterFilters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [lawmaticsOpen, setLawmaticsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [planType, setPlanType] = useState<PracticeAreaCode>('EP')
  const [deleteTarget, setDeleteTarget] = useState<MatterListRow | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [sendIntakeOnCreate, setSendIntakeOnCreate] = useState(true)
  const [createdMatterId, setCreatedMatterId] = useState<string | null>(null)
  const [createdIntakeUrl, setCreatedIntakeUrl] = useState<string | null>(null)

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

  const intakeStatuses = useMemo(() => {
    const set = new Set<string>()
    for (const matter of matters) {
      if (matter.intake_status) set.add(matter.intake_status)
    }
    return Array.from(set).sort()
  }, [matters])

  const hasActiveFilters = useMemo(() => {
    return Boolean(
      search.trim()
      || filters.practice !== 'all'
      || filters.stage !== 'all'
      || filters.intake !== 'all',
    )
  }, [filters, search])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return matters.filter(m => {
      if (q) {
        const hay = [
          m.matter_number,
          m.client_name,
          m.client_email,
          m.client_phone,
          m.matter_name,
          m.practice_area,
          m.stage,
          m.intake_status,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.practice !== 'all' && m.practice_area !== filters.practice) return false
      if (filters.stage !== 'all' && m.stage !== filters.stage) return false
      if (filters.intake !== 'all' && (m.intake_status ?? '') !== filters.intake) return false
      return true
    })
  }, [filters, matters, search])

  const selectedIds = useMemo(
    () => filtered.filter(m => selected[m.matter_id]).map(m => m.matter_id),
    [filtered, selected],
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selected[m.matter_id])

  const updateFilter = <K extends keyof MatterFilters>(key: K, value: MatterFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value }))
  }

  const clearFilters = () => {
    setSearch('')
    setFilters(EMPTY_FILTERS)
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

  const handleDelete = async () => {
    if (!token || !deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/matters/${deleteTarget.matter_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not delete matter')
      toast.success(`Deleted matter for ${deleteTarget.client_name || 'client'}`)
      setDeleteTarget(null)
      setSelected(current => {
        const next = { ...current }
        delete next[deleteTarget.matter_id]
        return next
      })
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete matter')
    } finally {
      setDeleting(false)
    }
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
        body: JSON.stringify({ ids: selectedIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not delete matters')

      const deleted = typeof body.deleted === 'number' ? body.deleted : selectedIds.length
      const failed = Array.isArray(body.results)
        ? body.results.filter((result: { ok?: boolean }) => !result.ok).length
        : 0

      if (failed > 0) {
        toast.error(`Deleted ${deleted} matter${deleted === 1 ? '' : 's'}; ${failed} failed`)
      } else {
        toast.success(`Deleted ${deleted} matter${deleted === 1 ? '' : 's'}`)
      }

      setBulkDeleteOpen(false)
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
    : matters.length === 0
      ? 'No matters yet. Create one to get started.'
      : hasActiveFilters
        ? 'No matters match the current filters.'
        : 'No matters to show.'

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="space-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-2 text-xl font-semibold tracking-tight">Matters</h1>
          <div className="flex max-w-md min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:border-accent">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search all fields…"
              className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              aria-label="Search matters"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLawmaticsOpen(true)}>
              <Database className="h-3.5 w-3.5" />
              Import from Lawmatics
            </Button>
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Create Matter
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Practice
            <select
              value={filters.practice}
              onChange={e => updateFilter('practice', e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="all">All</option>
              {PRACTICE_AREA_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Stage
            <select
              value={filters.stage}
              onChange={e => updateFilter('stage', e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="all">All</option>
              {STAGES.map(stage => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Intake
            <select
              value={filters.intake}
              onChange={e => updateFilter('intake', e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="all">All</option>
              {intakeStatuses.map(status => (
                <option key={status} value={status}>
                  {intakeStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
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
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-6 py-16 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            {!loadError && matters.length === 0 && (
              <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Create Matter
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <Table className="min-w-[72rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={checked => toggleAllFiltered(checked === true)}
                      aria-label="Select all visible matters"
                    />
                  </TableHead>
                  <TableHead>Matter Number</TableHead>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Practice Area</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Intake</TableHead>
                  <TableHead className="w-10" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => (
                  <TableRow key={m.matter_id}>
                    <TableCell>
                      <Checkbox
                        checked={Boolean(selected[m.matter_id])}
                        onCheckedChange={checked => toggleSelected(m.matter_id, checked === true)}
                        aria-label={`Select matter for ${m.client_name || 'client'}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.matter_number || '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/matters/${m.matter_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {m.client_name || m.matter_name || 'Untitled'}
                        </Link>
                        {(m.unreviewed_upload_count ?? 0) > 0 && (
                          <Badge
                            variant="outline"
                            className="border-amber-border bg-amber-bg text-[10px] text-amber"
                            title={formatUnreviewedUploadDetail(
                              mergeUnreviewedCounts(
                                m.unreviewed_intake_upload_count ?? 0,
                                m.unreviewed_portal_upload_count ?? 0,
                              ),
                            )}
                          >
                            {formatUnreviewedUploadLabel(
                              mergeUnreviewedCounts(
                                m.unreviewed_intake_upload_count ?? 0,
                                m.unreviewed_portal_upload_count ?? 0,
                              ),
                            )}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.client_email || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.client_phone || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {practiceAreaLabel(m.practice_area)}
                    </TableCell>
                    <TableCell>{stageLabel(m.stage)}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {intakeStatusLabel(m.intake_status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label={`Delete matter for ${m.client_name || 'client'}`}
                        onClick={() => setDeleteTarget(m)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
                onChange={e => setClientPhone(e.target.value)}
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

      <Dialog open={deleteTarget !== null} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete matter?</DialogTitle>
            <DialogDescription>
              This permanently deletes{' '}
              <span className="font-medium text-foreground">
                {deleteTarget?.client_name || deleteTarget?.matter_name || 'this matter'}
              </span>
              , including intake, documents, design sheet, and messages. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete matter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={open => !open && setBulkDeleteOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.length} matter{selectedIds.length === 1 ? '' : 's'}?</DialogTitle>
            <DialogDescription>
              This permanently deletes the selected matters, including intake, documents, design sheets, and messages.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleBulkDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : `Delete ${selectedIds.length} matter${selectedIds.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LawmaticsImportDialog open={lawmaticsOpen} onOpenChange={setLawmaticsOpen} />
    </div>
  )
}
