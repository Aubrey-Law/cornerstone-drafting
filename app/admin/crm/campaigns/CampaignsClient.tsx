'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Mail, Plus, RefreshCw, Send, StopCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  CrmCampaignAudienceRules,
  CrmCampaignListItem,
  CrmPeopleFilter,
  getLifecycleLabel,
} from '@/lib/queries/cornerstoneCrm'
import { EmptyState } from '@/components/EmptyState'
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
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SearchField } from '@/components/SearchField'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, cn } from '@/lib/utils'


type CampaignStatus = CrmCampaignListItem['status'] | 'all'
type CampaignAction = 'queue' | 'run'

const LIFECYCLE_OPTIONS: Array<CrmPeopleFilter['lifecycle']> = [
  'all',
  'new',
  'contacted',
  'nurture',
  'qualified',
  'working',
  'converted',
  'closed_lost',
]

const STATUS_ORDER: CampaignStatus[] = ['all', 'draft', 'running', 'scheduled', 'completed', 'paused', 'cancelled']

const DEFAULT_AUDIENCE: CrmCampaignAudienceRules = {
  lifecycleStatuses: [...LIFECYCLE_OPTIONS],
  onlyWithEmail: true,
  includeOptedOut: false,
  search: '',
  stageIds: [],
}

interface QueueCampaignResult {
  campaignId: string
  queued: number
  added: number
  updated: number
}

interface RunCampaignResult {
  campaignId: string
  sent: number
  failed: number
  processed: number
  nextQueued: number
}

function campaignStatusLabel(status: CrmCampaignListItem['status']) {
  const map: Record<CrmCampaignListItem['status'], string> = {
    draft: 'Draft',
    scheduled: 'Scheduled',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return map[status]
}

function campaignTypeLabel(type: CrmCampaignListItem['type']) {
  return type === 'newsletter' ? 'Newsletter' : 'Nurture'
}

function normalizeAudienceRuleSelection(
  selected: CrmCampaignAudienceRules,
  lifecycle: CrmPeopleFilter['lifecycle'],
  selectedState: boolean,
) {
  const options = selected.lifecycleStatuses
  if (selectedState) {
    if (lifecycle === 'all') return { ...selected, lifecycleStatuses: [...LIFECYCLE_OPTIONS] }
    const next = new Set(options)
    next.add(lifecycle)
    next.delete('all')
    return { ...selected, lifecycleStatuses: [...next] }
  }

  if (lifecycle === 'all') return { ...selected, lifecycleStatuses: ['new', 'contacted', 'nurture', 'qualified', 'working', 'converted', 'closed_lost'] }
  const next = new Set(options)
  next.delete(lifecycle)
  if (!next.size) {
    return { ...selected, lifecycleStatuses: ['new', 'contacted', 'nurture', 'qualified', 'working', 'converted', 'closed_lost'] }
  }
  return { ...selected, lifecycleStatuses: [...next] }
}

function isLifecycleSelected(selected: CrmCampaignAudienceRules, lifecycle: CrmPeopleFilter['lifecycle']) {
  if (lifecycle === 'all') {
    return selected.lifecycleStatuses.length === LIFECYCLE_OPTIONS.length
  }
  return selected.lifecycleStatuses.includes(lifecycle)
}

export function CrmCampaignsClient({ initialCampaigns }: { initialCampaigns: CrmCampaignListItem[] }) {
  const router = useRouter()
  const token = useAccessToken()
  const [campaigns, setCampaigns] = useState(initialCampaigns)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CampaignStatus>('all')
  const [name, setName] = useState('')
  const [type, setType] = useState<CrmCampaignListItem['type']>('nurture')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState<CrmCampaignAudienceRules>(DEFAULT_AUDIENCE)
  const [isCreating, setIsCreating] = useState(false)
  const [refreshing, startRefreshing] = useTransition()
  const [busyByCampaign, setBusyByCampaign] = useState<Record<string, CampaignAction | null>>({})

  useEffect(() => {
    setCampaigns(initialCampaigns)
  }, [initialCampaigns])

  const filtered = useMemo(() => {
    const lowered = search.trim().toLowerCase()
    return campaigns.filter(campaign =>
      (statusFilter === 'all' || campaign.status === statusFilter)
      && (campaign.name.toLowerCase().includes(lowered)
        || campaign.subject?.toLowerCase().includes(lowered)
        || campaign.audienceRules.search.toLowerCase().includes(lowered)),
    )
  }, [campaigns, search, statusFilter])

  const statusCounts = useMemo(() => {
    const counts: Record<CampaignStatus, number> = {
      all: campaigns.length,
      draft: 0,
      scheduled: 0,
      running: 0,
      paused: 0,
      completed: 0,
      cancelled: 0,
    }
    for (const campaign of campaigns) counts[campaign.status] += 1
    return counts
  }, [campaigns])

  const apiRequest = async (url: string, init: RequestInit = {}) => {
    if (!token) {
      toast.error('Not signed in')
      return null
    }

    const headers = new Headers()
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body) headers.set('Content-Type', 'application/json')

    return fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        ...Object.fromEntries(headers.entries()),
      },
    })
  }

  const refresh = () => {
    startRefreshing(() => {
      router.refresh()
    })
  }

  const createCampaign = async () => {
    if (!token) return
    if (!name.trim() || !subject.trim() || !body.trim()) {
      toast.error('Name, subject, and body are required')
      return
    }

    setIsCreating(true)
    try {
      const response = await apiRequest('/api/admin/crm/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name,
          type,
          subject,
          bodyText: body,
          audienceRules: audience,
          emailProvider: 'sendgrid',
        }),
      })

      const payload = await response?.json().catch(() => ({}))
      if (!response?.ok) {
        toast.error(payload?.error ?? 'Could not create campaign')
        return
      }

      const created = payload?.campaign
      if (created?.id) {
        setCampaigns(prev => [
          {
            ...created,
            recipientCounts: created.recipientCounts ?? {
              total: 0,
              queued: 0,
              sent: 0,
              delivered: 0,
              opened: 0,
              clicked: 0,
              bounced: 0,
              failed: 0,
              complaint: 0,
              unsubscribed: 0,
            },
          },
          ...prev,
        ])
      }

      setName('')
      setSubject('')
      setBody('')
      setAudience(DEFAULT_AUDIENCE)
      toast.success('Campaign created')
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Create campaign failed')
    } finally {
      setIsCreating(false)
    }
  }

  const runCampaignAction = async (campaignId: string, action: CampaignAction, limit?: number) => {
    if (!token) return
    setBusyByCampaign(current => ({ ...current, [campaignId]: action }))

    try {
      const url = `/api/admin/crm/campaigns/${campaignId}/${action}`
      const body = action === 'run' ? (limit ? { limit } : {}) : undefined
      const response = await apiRequest(url, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = await response?.json().catch(() => null)

      if (!response?.ok) {
        toast.error(payload?.error ?? `Campaign ${action} failed`)
        return
      }

      if (action === 'queue') {
        const queuePayload = payload as QueueCampaignResult
        setCampaigns(existing => existing.map(campaign =>
          campaign.id === campaignId
            ? {
              ...campaign,
              status: queuePayload?.queued ? 'running' : 'draft',
              recipientCounts: {
                ...campaign.recipientCounts,
                total: queuePayload?.queued ?? campaign.recipientCounts.total,
                queued: queuePayload?.queued ?? campaign.recipientCounts.queued,
              },
            }
            : campaign,
        ))
        toast.success(`Queued ${queuePayload?.queued ?? 0} recipients`)
      } else {
        const runPayload = payload as RunCampaignResult
        setCampaigns(existing => existing.map(campaign =>
          campaign.id === campaignId
            ? {
              ...campaign,
              status: (runPayload.nextQueued ?? 0) > 0 ? 'running' : 'completed',
              recipientCounts: {
                ...campaign.recipientCounts,
                sent: campaign.recipientCounts.sent + (runPayload?.sent ?? 0),
                failed: campaign.recipientCounts.failed + (runPayload?.failed ?? 0),
                queued: typeof runPayload?.nextQueued === 'number'
                  ? runPayload.nextQueued
                  : Math.max(0, campaign.recipientCounts.queued - (runPayload?.processed ?? 0)),
              },
            }
            : campaign,
        ))
        toast.success(`Sent ${runPayload?.sent ?? 0} now`)
      }

      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${action} failed`)
    } finally {
      setBusyByCampaign(current => ({ ...current, [campaignId]: null }))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="CRM Campaigns"
        eyebrow="Lead nurture + newsletters"
        icon={Mail}
        description="Create and dispatch simple nurture campaigns directly from the Cornerstone CRM. Keep it lightweight while you validate list quality and frequency."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>
            <Button type="button" asChild variant="secondary" size="sm">
              <Link href="/admin/crm">People</Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Create campaign</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Estate Planning Nurture - June"
              />
            </label>
            <label className="space-y-1">
              <Label htmlFor="campaign-subject">Email subject</Label>
              <Input
                id="campaign-subject"
                value={subject}
                onChange={event => setSubject(event.target.value)}
                placeholder="Helpful estate planning checklist"
              />
            </label>
          </div>

          <div>
            <Label className="mb-1 block">Campaign type</Label>
            <Tabs value={type} onValueChange={next => setType(next === 'newsletter' ? 'newsletter' : 'nurture')}>
              <TabsList>
                <TabsTrigger value="newsletter">Newsletter</TabsTrigger>
                <TabsTrigger value="nurture">Nurture</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <label className="space-y-1">
            <Label htmlFor="campaign-body">Email body</Label>
            <Textarea
              id="campaign-body"
              value={body}
              onChange={event => setBody(event.target.value)}
              rows={7}
              placeholder="Write the email copy for this campaign. Plain text works; line breaks are preserved."
            />
          </label>

          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Audience rules</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={audience.onlyWithEmail}
                  onCheckedChange={value => setAudience(current => ({ ...current, onlyWithEmail: Boolean(value) }))}
                />
                Require email address
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={audience.includeOptedOut}
                  onCheckedChange={value => setAudience(current => ({ ...current, includeOptedOut: Boolean(value) }))}
                />
                Include opt-out contacts
              </label>
            </div>

            <div className="space-y-2">
              <Label>Life-cycle filter</Label>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
                {LIFECYCLE_OPTIONS.map(option => (
                  <label key={option} className="flex items-center gap-2">
                    <Checkbox
                      checked={isLifecycleSelected(audience, option)}
                      onCheckedChange={value =>
                        setAudience(current => normalizeAudienceRuleSelection(current, option, Boolean(value)))}
                    />
                    <span>{getLifecycleLabel(option)}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="space-y-1">
              <Label>Audience search (optional)</Label>
              <Input
                value={audience.search}
                onChange={event => setAudience(current => ({ ...current, search: event.target.value }))}
                placeholder="E.g. first name, city, email"
              />
            </label>
          </div>

          <Button type="button" onClick={() => void createCampaign()} disabled={isCreating || !token}>
            <Plus className="mr-2 h-4 w-4" />
            {isCreating ? 'Creating…' : 'Create campaign'}
          </Button>
        </CardContent>
      </Card>

      <SearchField
        value={search}
        onValueChange={setSearch}
        placeholder="Search name, subject, or audience label"
        aria-label="Search campaigns"
      />

      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map(value => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={statusFilter === value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(value)}
          >
            {value === 'all' ? 'All' : campaignStatusLabel(value)}
            <span className="ml-2 text-xs text-muted-foreground">({statusCounts[value]})</span>
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No campaigns match this view"
          description="Create a first campaign to start lead nurture outreach from within Cornerstone."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Lifecycle audience</TableHead>
                <TableHead>Queued / Sent / Failed</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-[190px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(campaign => {
                const busy = busyByCampaign[campaign.id]
                return (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <p className="font-medium">{campaign.name}</p>
                      <p className="text-xs text-muted-foreground">{campaign.subject || 'No subject'}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{campaign.bodyText?.slice(0, 120) ?? ''}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{campaignTypeLabel(campaign.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={campaign.status === 'running' ? 'default' : 'outline'}>
                        {campaignStatusLabel(campaign.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{campaign.audienceRules.lifecycleStatuses.join(', ') || 'All'}</span>
                      {campaign.audienceRules.search ? (
                        <p className="text-xs text-muted-foreground">Search: {campaign.audienceRules.search}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm tabular-nums">
                        {campaign.recipientCounts.queued} / {campaign.recipientCounts.sent} / {campaign.recipientCounts.failed}
                      </p>
                    </TableCell>
                    <TableCell>{formatDateTime(campaign.updatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push(`/admin/crm/campaigns/${campaign.id}`)}
                          type="button"
                        >
                          Open
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runCampaignAction(campaign.id, 'queue')}
                          disabled={!token || busy === 'queue' || campaign.status === 'cancelled'}
                        >
                          {busy === 'queue' ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                          Queue now
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void runCampaignAction(campaign.id, 'run', 200)}
                          disabled={!token || busy === 'run' || !campaign.recipientCounts.queued}
                        >
                          {busy === 'run' ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                          Send queued
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void runCampaignAction(campaign.id, 'run', 1)}
                          disabled={!token || busy === 'run'}
                        >
                          <StopCircle className="mr-1 h-3.5 w-3.5" />
                          Ping 1
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
