'use client'

import { useMemo, useState, useEffect, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Briefcase, ChevronRight, Database, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  EMPTY_MATTER_TABLE_FILTERS,
  filterAndSortMatters,
  matterLastActivityAt,
  type MatterSortKey,
  type MatterTableFilters,
} from '@/lib/adminTables/matterTable'
import type { MatterListRow } from '@/lib/queries/matters'
import { formatUnreviewedUploadDetail, formatUnreviewedUploadLabel, mergeUnreviewedCounts } from '@/lib/matter/unreviewedUploads'
import { PRACTICE_AREA_OPTIONS, practiceAreaLabel, type PracticeAreaCode } from '@/lib/practiceArea'
import { GROUP_COLORS, stageInfo, stageLabel, type StageGroup } from '@/types/database'
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

const GROUP_LABELS: Record<StageGroup, string> = {
  early: 'Intake',
  active: 'Drafting',
  work: 'Client work',
  done: 'Signing',
  closed: 'Closed',
}

const GROUP_ORDER: StageGroup[] = ['early', 'active', 'work', 'done', 'closed']

/** Days since a matter last moved, for the Last activity and quiet columns. */
const QUIET_DAYS = 10

function intakeStatusLabel(status: string | null | undefined) {
  return status?.replace(/_/g, ' ') || '—'
}

const INTAKE_BADGE_CLASS: Record<string, string> = {
  submitted: 'border-green/40 bg-green-bg text-green',
  in_progress: 'border-blue-strong-border bg-blue-bg text-blue',
}

function daysSince(ms: number): number {
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

function formatLastActivity(ms: number | null): string {
  if (ms === null) return '—'
  const days = daysSince(ms)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
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
  const [filters, setFilters] = useState<MatterTableFilters>(EMPTY_MATTER_TABLE_FILTERS)
  const [sortKey, setSortKey] = useState<MatterSortKey>('last_activity')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [lawmaticsOpen, setLawmaticsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [planType, setPlanType] = useState<PracticeAreaCode>('EP')
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

  const groupCounts = useMemo(() => {
    const counts: Record<StageGroup, number> = { early: 0, active: 0, work: 0, done: 0, closed: 0 }
    for (const matter of matters) counts[stageInfo(matter.stage).group] += 1
    return counts
  }, [matters])

  const hasActiveFilters = useMemo(() => {
    return Boolean(filters.search.trim() || filters.practice !== 'all' || filters.stageGroup !== 'all')
  }, [filters])

  const filtered = useMemo(
    () => filterAndSortMatters(matters, filters, sortKey),
    [filters, matters, sortKey],
  )

  const selectedIds = useMemo(
    () => filtered.filter(m => selected[m.matter_id]).map(m => m.matter_id),
    [filtered, selected],
  )

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selected[m.matter_id])

  const updateFilter = <K extends keyof MatterTableFilters>(key: K, value: MatterTableFilters[K]) => {
    setFilters(current => ({ ...current, [key]: value }))
  }

  const clearFilters = () => {
    setFilters(EMPTY_MATTER_TABLE_FILTERS)
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
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-foreground md:-mx-6 md:-mb-6">
      <div className="space-y-3 border-b border-border bg-card px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-2 text-xl font-semibold tracking-tight">Matters</h1>
          <div className="flex max-w-md min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 focus-within:border-accent">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={filters.search}
              onChange={e => updateFilter('search', e.target.value)}
              placeholder="Search all fields…"
              className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              aria-label="Search matters"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => updateFilter('search', '')}
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
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => updateFilter('stageGroup', 'all')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filters.stageGroup === 'all'
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All · {matters.length}
          </button>
          {GROUP_ORDER.map(group => (
            <button
              key={group}
              type="button"
              onClick={() => updateFilter('stageGroup', filters.stageGroup === group ? 'all' : group)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filters.stageGroup === group
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: GROUP_COLORS[group].dot }}
              />
              {GROUP_LABELS[group]} · {groupCounts[group]}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
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
            <Select value={sortKey} onValueChange={value => setSortKey(value as MatterSortKey)}>
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
                  <TableHead>Client</TableHead>
                  <TableHead>Practice Area</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Intake</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead>Attention</TableHead>
                  <TableHead className="w-10" aria-label="Open matter" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(m => {
                  const group = stageInfo(m.stage).group
                  const groupColor = GROUP_COLORS[group]
                  const unreviewed = mergeUnreviewedCounts(
                    m.unreviewed_intake_upload_count ?? 0,
                    m.unreviewed_portal_upload_count ?? 0,
                  )
                  const activity = matterLastActivityAt(m)
                  const quietDays = activity === null ? null : daysSince(activity)
                  return (
                    <TableRow key={m.matter_id}>
                      <TableCell>
                        <Checkbox
                          checked={Boolean(selected[m.matter_id])}
                          onCheckedChange={checked => toggleSelected(m.matter_id, checked === true)}
                          aria-label={`Select matter for ${m.client_name || 'client'}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/admin/matters/${m.matter_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {m.client_name || m.matter_name || 'Untitled'}
                        </Link>
                        {m.matter_number && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">
                            {m.matter_number}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {practiceAreaLabel(m.practice_area)}
                      </TableCell>
                      <TableCell>
                        <span
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
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
                          className={`text-[10px] capitalize ${
                            INTAKE_BADGE_CLASS[m.intake_status ?? ''] ?? 'text-muted-foreground'
                          }`}
                        >
                          {intakeStatusLabel(m.intake_status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatLastActivity(activity)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {unreviewed.total > 0 && (
                            <Badge
                              variant="outline"
                              className="border-amber-border bg-amber-bg text-[10px] text-amber"
                              title={formatUnreviewedUploadDetail(unreviewed)}
                            >
                              {formatUnreviewedUploadLabel(unreviewed)}
                            </Badge>
                          )}
                          {quietDays !== null && quietDays > QUIET_DAYS && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              quiet {quietDays}d
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/admin/matters/${m.matter_id}`}
                          className="inline-flex rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
