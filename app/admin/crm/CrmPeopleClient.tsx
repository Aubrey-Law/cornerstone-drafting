'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  ExternalLink,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  filterCrmPeople,
  type CrmPeopleFilter,
  type CrmPeopleRow,
  getLifecycleLabel,
} from '@/lib/queries/cornerstoneCrm'
import { EmptyState } from '@/components/EmptyState'
import { FilterChip } from '@/components/FilterChip'
import { SearchField } from '@/components/SearchField'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTime } from '@/lib/utils'
import { phoneTelHref } from '@/lib/phone'

interface CrmPeopleClientProps {
  initialPeople: CrmPeopleRow[]
  twentyContactUrlTemplate?: string
}

const LIFECYCLE_OPTIONS: CrmPeopleFilter['lifecycle'][] = [
  'all',
  'new',
  'contacted',
  'nurture',
  'qualified',
  'working',
  'converted',
  'closed_lost',
]

function resolveTwentyLink(template: string, id: string): string {
  return template.includes('{id}')
    ? template.replace('{id}', encodeURIComponent(id))
    : `${template.replace(/\/$/, '')}/${encodeURIComponent(id)}`
}

export function CrmPeopleClient({
  initialPeople,
  twentyContactUrlTemplate = '',
}: CrmPeopleClientProps) {
  const router = useRouter()
  const token = useAccessToken()
  const [search, setSearch] = useState('')
  const [lifecycle, setLifecycle] = useState<CrmPeopleFilter['lifecycle']>('all')
  const [showOnlyWithEmail, setShowOnlyWithEmail] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [refreshing, startRefresh] = useTransition()

  const filter: CrmPeopleFilter = useMemo(() => ({
    search,
    lifecycle,
  }), [search, lifecycle])

  const visible = useMemo(() => {
    const base = filterCrmPeople(initialPeople, filter)
    return showOnlyWithEmail ? base.filter(person => Boolean(person.email)) : base
  }, [initialPeople, filter, showOnlyWithEmail])

  const counts = useMemo(() => {
    const totals = {
      all: initialPeople.length,
      new: 0,
      contacted: 0,
      nurture: 0,
      qualified: 0,
      working: 0,
      converted: 0,
      closed_lost: 0,
    }
    for (const person of initialPeople) {
      if (person.lifecycleStatus && totals[person.lifecycleStatus as keyof typeof totals] !== undefined) {
        totals[person.lifecycleStatus as keyof typeof totals] += 1
      }
    }
    return totals
  }, [initialPeople])

  const importLeads = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }

    setIsImporting(true)
    try {
      const response = await fetch('/api/admin/crm/import-leads', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'append' }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        toast.error(body?.error ?? 'Could not import leads')
        return
      }

      const inserted = body?.inserted ?? 0
      const skipped = body?.skipped ?? 0
      if (inserted > 0) {
        toast.success(`Imported ${inserted} lead${inserted === 1 ? '' : 's'} from existing leads`)
      }
      if (skipped > 0) {
        toast.info(`Skipped ${skipped} already imported lead${skipped === 1 ? '' : 's'}`)
      }
      if (inserted === 0 && skipped === 0) {
        toast.info('No leads were available to import yet.')
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Network error while importing')
    } finally {
      setIsImporting(false)
    }
  }

  const refreshFromDatabase = () => {
    startRefresh(() => {
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cornerstone CRM"
        eyebrow="Lead nurture"
        icon={Send}
        description="A lightweight record list for campaign-ready leads and prospects. Keep your nurture stack separate from core casework while staying in one app."
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void importLeads()}
              disabled={isImporting}
            >
              <Mail className={cn('mr-2 h-3.5 w-3.5', isImporting && 'animate-spin')} />
              {isImporting ? 'Importing…' : 'Import leads'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshFromDatabase}
              disabled={refreshing}
            >
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <SearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search name, email, city, source, matter"
          aria-label="Search CRM contacts"
          containerClassName="w-full sm:w-96"
        />

        <Tabs value={showOnlyWithEmail ? 'email' : 'all'} onValueChange={value => setShowOnlyWithEmail(value === 'email')}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="email">With email</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-2">
        {LIFECYCLE_OPTIONS.map(option => (
          <FilterChip
            key={option}
            selected={lifecycle === option}
            count={counts[option]}
            onClick={() => setLifecycle(option)}
          >
            {getLifecycleLabel(option)}
          </FilterChip>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={initialPeople.length === 0 ? 'No CRM records yet' : 'No records for this filter'}
          description={
            initialPeople.length === 0
              ? 'Import leads to create your first nurture list and begin campaigns.'
              : 'Try adjusting the search or lifecycle filter.'
          }
          action={
            initialPeople.length === 0 ? (
              <Button type="button" size="sm" onClick={() => void importLeads()}>
                <Mail className="h-3.5 w-3.5" />
                Import leads
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Next follow-up</TableHead>
                <TableHead>Source record</TableHead>
                <TableHead className="w-[130px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(person => {
                const tel = phoneTelHref(person.phone)
                const externalLink =
                  person.twentyContactId && twentyContactUrlTemplate
                    ? resolveTwentyLink(twentyContactUrlTemplate, person.twentyContactId)
                    : null

                return (
                  <TableRow key={person.id}>
                    <TableCell>
                      <p className="font-medium">{person.name}</p>
                      {person.company && <p className="text-xs text-muted-foreground">{person.company}</p>}
                      {(person.jobTitle || person.city || person.state) && (
                        <p className="text-xs text-muted-foreground">
                          {[person.jobTitle, [person.city, person.state].filter(Boolean).join(', ')]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[11px]">
                        {person.lifecycleStatus ?? 'new'}
                      </Badge>
                    </TableCell>
                    <TableCell>{person.stageName ?? '—'}</TableCell>
                    <TableCell>
                      {person.email ? (
                        <a href={`mailto:${person.email}`} className="hover:underline">
                          {person.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {person.phone ? (
                        tel ? (
                          <a href={tel} className="hover:underline">
                            {person.phone}
                          </a>
                        ) : (
                          <span>{person.phone}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{person.leadSource ?? '—'}</p>
                      {person.referralSource && <p className="text-xs text-muted-foreground">ref {person.referralSource}</p>}
                    </TableCell>
                    <TableCell>
                      {person.nextFollowUpAt ? (
                        <span className="text-sm tabular-nums">{formatDateTime(person.nextFollowUpAt)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {person.sourceRecordHref ? (
                        <Link href={person.sourceRecordHref} className="inline-flex items-center text-sm hover:underline">
                          <span>{person.sourceRecordLabel ?? 'Open'}</span>
                          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {person.phone && tel && (
                          <a
                            href={tel}
                            aria-label={`Call ${person.name}`}
                            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {person.email && (
                          <a
                            href={`mailto:${person.email}`}
                            aria-label={`Email ${person.name}`}
                            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {externalLink && (
                          <a
                            href={externalLink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${person.name} in Twenty`}
                            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Showing {visible.length} of {initialPeople.length} records.
      </p>
    </div>
  )
}
