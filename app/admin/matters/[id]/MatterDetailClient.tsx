'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ChevronDown,
  ClipboardList,
  FilePenLine,
  Send,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { listDocuments } from '@/lib/documents'
import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { CallList } from '@/components/calls/CallList'
import {
  STAGES,
  stageLabel,
  type MatterActivity,
  type MatterContact,
  type MatterDocument,
  type MatterStage,
  type PipelineMatter,
} from '@/types/database'
import { supabase } from '@/lib/supabaseClient'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SetupBanner } from '@/components/SetupBanner'
import { computeMatterNextAction, matterDaysOpen } from '@/lib/matterNextAction'
import { useMessagesRealtime } from '@/lib/messages/useMessagesRealtime'
import { resolveMatterIntake } from '@/app/actions/adminIntake'
import { MatterOverviewHero } from './MatterOverviewHero'
import { MatterActivityTab } from './MatterActivityTab'
import { MatterOverviewContacts } from './MatterOverviewContacts'
import { MatterOverviewAssets } from './MatterOverviewAssets'
import { MatterAdditionalContactsTab } from './MatterAdditionalContactsTab'

const AdminIntakeSheet = dynamic(() => import('@/components/AdminIntakeSheet'), { ssr: false })
const ImportIntakeDialog = dynamic(() => import('./ImportIntakeDialog'), { ssr: false })

interface MatterDetailClientProps {
  matter: PipelineMatter
  matterId: string
  contacts: MatterContact[]
  agingHealth?: 'red' | 'amber' | 'green' | null
  intakeId?: string | null
  clientIntakeRow?: {
    id: string
    intake_sent_at: string | null
    intake_completed_at: string | null
    email: string | null
    first_name: string | null
    status?: string | null
    user_id?: string | null
    client_user_id?: string | null
    unlock_requested_at?: string | null
    unlock_request_note?: string | null
  } | null
  twilioSmsEnabled?: boolean
  emailSendEnabled?: boolean
}

type PortalMessage = {
  id: string
  body: string
  sender_role: string
  created_at: string
  read_at: string | null
}

type SmsMessage = {
  id: string
  direction: string
  recipient_role: string | null
  recipient_name: string | null
  body: string
  status: string
  from_number: string | null
  to_number: string | null
  created_at: string
  actor_name: string | null
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function MatterDetailClient({
  matter: initialMatter,
  matterId,
  contacts: initialContacts,
  agingHealth = null,
  intakeId: initialIntakeId = null,
  clientIntakeRow = null,
  twilioSmsEnabled = false,
  emailSendEnabled = false,
}: MatterDetailClientProps) {
  const token = useAccessToken()
  const router = useRouter()
  const [matter, setMatter] = useState(initialMatter)
  const [contacts, setContacts] = useState(initialContacts)
  const [liveIntakeId, setLiveIntakeId] = useState<string | null>(initialIntakeId)
  const [intakeCompleted, setIntakeCompleted] = useState(
    Boolean(clientIntakeRow?.intake_completed_at || matter.intake_status === 'completed'),
  )
  const [intakeSheetOpen, setIntakeSheetOpen] = useState(false)
  const [importIntakeOpen, setImportIntakeOpen] = useState(false)
  const [stageSaving, setStageSaving] = useState(false)
  const [sendingIntake, setSendingIntake] = useState(false)
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null)
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([])
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalDraft, setPortalDraft] = useState('')
  const [portalSending, setPortalSending] = useState(false)

  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>([])
  const [smsLoading, setSmsLoading] = useState(false)
  const [smsDraft, setSmsDraft] = useState('')
  const [smsRecipient, setSmsRecipient] = useState<'client' | 'spouse'>('client')
  const [smsSending, setSmsSending] = useState(false)

  const [emailTo, setEmailTo] = useState(initialMatter.client_email || '')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailSending, setEmailSending] = useState(false)

  const [activity, setActivity] = useState<MatterActivity[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  useEffect(() => {
    setMatter(initialMatter)
    setEmailTo(initialMatter.client_email || '')
  }, [initialMatter])

  useEffect(() => {
    setContacts(initialContacts)
  }, [initialContacts])

  useEffect(() => {
    setLiveIntakeId(initialIntakeId)
  }, [initialIntakeId])

  const openIntakeSheet = useCallback(async () => {
    if (liveIntakeId) {
      setIntakeSheetOpen(true)
      return
    }
    try {
      const resolved = await resolveMatterIntake(matterId)
      if (resolved) {
        setLiveIntakeId(resolved)
        setIntakeSheetOpen(true)
      } else {
        setIntakeSheetOpen(true)
      }
    } catch {
      setIntakeSheetOpen(true)
    }
  }, [liveIntakeId, matterId])

  const loadPortalMessages = useCallback(async () => {
    if (!token) return
    setPortalLoading(true)
    try {
      const res = await fetch(`/api/messages?matter_id=${encodeURIComponent(matter.matter_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => [])
      if (res.ok) setPortalMessages(Array.isArray(body) ? body : [])
    } catch {
      /* ignore */
    } finally {
      setPortalLoading(false)
    }
  }, [token, matter.matter_id])

  const loadSmsMessages = useCallback(async () => {
    if (!token) return
    setSmsLoading(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/sms-messages`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => [])
      if (res.ok) setSmsMessages(Array.isArray(body) ? body : [])
    } catch {
      /* ignore */
    } finally {
      setSmsLoading(false)
    }
  }, [token, matter.matter_id])

  useEffect(() => {
    void loadPortalMessages()
    void loadSmsMessages()
  }, [loadPortalMessages, loadSmsMessages])

  const handlePortalMessageInsert = useCallback((message: PortalMessage) => {
    setPortalMessages(current => {
      if (current.some(row => row.id === message.id)) return current
      return [...current, message]
    })
  }, [])

  useMessagesRealtime(matter.matter_id, handlePortalMessageInsert)

  const loadActivity = useCallback(async () => {
    setActivityLoading(true)
    try {
      const { data, error } = await supabase
        .from('matter_activity')
        .select('*')
        .eq('matter_id', matter.matter_id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (!error) setActivity((data ?? []) as MatterActivity[])
    } finally {
      setActivityLoading(false)
    }
  }, [matter.matter_id])

  useEffect(() => {
    void loadActivity()
  }, [loadActivity])

  const sendPortalMessage = async () => {
    if (!token || !portalDraft.trim()) return
    setPortalSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ matter_id: matter.matter_id, body: portalDraft.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Send failed')
      setPortalDraft('')
      toast.success('Message sent')
      await loadPortalMessages()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send message')
    } finally {
      setPortalSending(false)
    }
  }

  const sendSms = async () => {
    if (!token || !smsDraft.trim()) return
    setSmsSending(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/send-sms`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recipient: smsRecipient, body: smsDraft.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'SMS failed')
      setSmsDraft('')
      toast.success('Text sent')
      await loadSmsMessages()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send SMS')
    } finally {
      setSmsSending(false)
    }
  }

  const sendEmail = async () => {
    if (!token || !emailTo.trim() || !emailSubject.trim() || !emailBody.trim()) return
    setEmailSending(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/send-email`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: emailTo.trim(),
          subject: emailSubject.trim(),
          text: emailBody.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Email failed')
      setEmailSubject('')
      setEmailBody('')
      toast.success(body.provider === 'graph' ? 'Email sent via Outlook' : 'Email sent')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send email')
    } finally {
      setEmailSending(false)
    }
  }

  const loadDocuments = useCallback(async () => {
    setDocsLoading(true)
    try {
      const docs = await listDocuments(matter.matter_id)
      setDocuments(docs)
    } catch {
      setDocuments([])
    } finally {
      setDocsLoading(false)
    }
  }, [matter.matter_id])

  useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  const docsByFolder = useMemo(() => {
    const map = new Map<string, MatterDocument[]>()
    for (const doc of documents) {
      const folder = doc.folder || 'other'
      const list = map.get(folder) ?? []
      list.push(doc)
      map.set(folder, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [documents])

  const handleStageChange = async (stage: MatterStage) => {
    if (!token || stage === matter.stage) return
    setStageSaving(true)
    const previous = matter.stage
    setMatter(m => ({ ...m, stage }))
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/stage`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stage }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not update stage')
      toast.success(`Stage updated to ${stageLabel(stage)}`)
      router.refresh()
    } catch (e) {
      setMatter(m => ({ ...m, stage: previous }))
      toast.error(e instanceof Error ? e.message : 'Could not update stage')
    } finally {
      setStageSaving(false)
    }
  }

  const handleSendIntake = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setSendingIntake(true)
    setIntakeUrl(null)
    try {
      const res = await fetch('/api/admin/intake/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ matterId: matter.matter_id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not send intake')
      if (typeof body.url === 'string') setIntakeUrl(body.url)
      setMatter(m => ({
        ...m,
        intake_sent_at: new Date().toISOString(),
        intake_status: m.intake_status === 'completed' ? m.intake_status : 'sent',
      }))
      toast.success('Intake link ready')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send intake')
    } finally {
      setSendingIntake(false)
    }
  }

  const copyIntakeUrl = async () => {
    if (!intakeUrl) return
    try {
      await navigator.clipboard.writeText(intakeUrl)
      toast.success('Intake link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  const handleDeleteMatter = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/matters/${matter.matter_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not delete matter')
      toast.success('Matter deleted')
      setDeleteOpen(false)
      router.push('/admin/matters')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete matter')
    } finally {
      setDeleting(false)
    }
  }

  const matterLabel = matter.client_name || matter.matter_name || 'this matter'
  const nextAction = useMemo(() => computeMatterNextAction(matter), [matter])
  const daysOpen = useMemo(() => matterDaysOpen(matter.matter_created), [matter.matter_created])
  const unreadPortalCount = useMemo(
    () => portalMessages.filter(m => m.sender_role === 'client' && !m.read_at).length,
    [portalMessages],
  )
  const lastPortalMessage = portalMessages.length > 0 ? portalMessages[portalMessages.length - 1] : null

  return (
    <div className="-mx-4 -mb-4 flex h-full flex-col bg-background text-[13px] text-foreground md:-mx-6 md:-mb-6">
      <div className="border-b border-border bg-card px-4 py-4 md:px-6">
        <div className="mb-3">
          <Link
            href="/admin/matters"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Matters
          </Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {matter.client_name || matter.matter_name || 'Matter'}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {matter.practice_area || 'Estate Planning'}
              {matter.matter_name ? ` · ${matter.matter_name}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" className="gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Intake
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void openIntakeSheet()}>
                  <ClipboardList className="mr-2 h-3.5 w-3.5" />
                  {intakeCompleted ? 'Edit intake' : liveIntakeId ? 'Update intake' : 'Create intake'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportIntakeOpen(true)}>
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  Import intake — paste text or upload Word
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={`/admin/drafting/${matter.matter_id}`}>
                <FilePenLine className="h-3.5 w-3.5" />
                Open drafting
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
        <Tabs defaultValue="overview" className="gap-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="contacts">Additional Contacts</TabsTrigger>
            <TabsTrigger value="communications">Communications</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <MatterOverviewHero
              stage={matter.stage}
              daysOpen={daysOpen}
              agingHealth={agingHealth}
              nextAction={nextAction}
              unreadPortalCount={unreadPortalCount}
              lastPortalMessage={lastPortalMessage}
              onSendIntake={() => void handleSendIntake()}
              sendIntakePending={sendingIntake}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Client
                </p>
                <p className="text-sm font-medium">{matter.client_name || '—'}</p>
                <p className="text-xs text-muted-foreground">{matter.client_email || '—'}</p>
                <p className="text-xs text-muted-foreground">{matter.client_phone || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Stage
                </p>
                <Select
                  value={matter.stage}
                  onValueChange={v => void handleStageChange(v as MatterStage)}
                  disabled={stageSaving}
                >
                  <SelectTrigger className="h-8 w-full max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGES.map(s => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Intake status
                </p>
                <p className="text-sm capitalize">
                  {matter.intake_status?.replace(/_/g, ' ') || '—'}
                </p>
                {matter.intake_sent_at && (
                  <p className="text-xs text-muted-foreground">
                    Sent {new Date(matter.intake_sent_at).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSendIntake()}
                disabled={sendingIntake}
              >
                <Send className="h-3.5 w-3.5" />
                {sendingIntake ? 'Sending…' : 'Send intake'}
              </Button>
              {intakeUrl && (
                <Button type="button" size="sm" variant="outline" onClick={() => void copyIntakeUrl()}>
                  Copy intake link
                </Button>
              )}
            </div>
            {intakeUrl && (
              <p className="break-all rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {intakeUrl}
              </p>
            )}

            <MatterOverviewContacts matterId={matterId} matter={matter} />
            <MatterOverviewAssets matterId={matterId} matter={matter} intakeId={liveIntakeId} />
          </TabsContent>

          <TabsContent value="documents" className="space-y-4">
            {docsLoading ? (
              <p className="text-xs text-muted-foreground">Loading documents…</p>
            ) : docsByFolder.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-xs text-muted-foreground">
                No documents for this matter yet.
              </div>
            ) : (
              docsByFolder.map(([folder, docs]) => (
                <div key={folder} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {folder}
                  </h3>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {docs.map(doc => (
                      <li
                        key={doc.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="font-medium">{doc.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(doc.size)}
                          {doc.created_at
                            ? ` · ${new Date(doc.created_at).toLocaleDateString()}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="contacts">
            <MatterAdditionalContactsTab
              matterId={matterId}
              matter={matter}
              initialContacts={contacts}
            />
          </TabsContent>

          <TabsContent value="communications" className="space-y-8">
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Portal messages</h3>
                <p className="text-xs text-muted-foreground">
                  In-app thread with the client portal.
                </p>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                {portalLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : portalMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No portal messages yet.</p>
                ) : (
                  portalMessages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-md px-2.5 py-2 text-xs ${
                        m.sender_role === 'client'
                          ? 'bg-muted/50'
                          : 'bg-primary/10'
                      }`}
                    >
                      <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="capitalize">{m.sender_role}</span>
                        <span>{new Date(m.created_at).toLocaleString()}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={portalDraft}
                  onChange={(e) => setPortalDraft(e.target.value)}
                  placeholder="Write a portal message…"
                  rows={2}
                  className="min-h-[60px]"
                />
                <Button
                  type="button"
                  size="sm"
                  className="shrink-0 self-end"
                  disabled={portalSending || !portalDraft.trim()}
                  onClick={() => void sendPortalMessage()}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">SMS</h3>
                <p className="text-xs text-muted-foreground">
                  Text thread with the client or spouse.
                </p>
              </div>
              {!twilioSmsEnabled ? (
                <SetupBanner
                  feature="SMS"
                  detail="Add Twilio credentials in environment variables to text clients from this tab."
                />
              ) : (
                <>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3">
                    {smsLoading ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : smsMessages.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No texts yet.</p>
                    ) : (
                      smsMessages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-md px-2.5 py-2 text-xs ${
                            m.direction === 'inbound' ? 'bg-muted/50' : 'bg-primary/10'
                          }`}
                        >
                          <div className="mb-0.5 flex justify-between gap-2 text-[10px] text-muted-foreground">
                            <span>
                              {m.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                              {m.recipient_name ? ` · ${m.recipient_name}` : ''}
                              {m.status ? ` · ${m.status}` : ''}
                            </span>
                            <span>{new Date(m.created_at).toLocaleString()}</span>
                          </div>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-36">
                      <Label className="text-[11px]">To</Label>
                      <Select
                        value={smsRecipient}
                        onValueChange={(v) => setSmsRecipient(v as 'client' | 'spouse')}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="client">Client</SelectItem>
                          <SelectItem value="spouse">Spouse</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Textarea
                      value={smsDraft}
                      onChange={(e) => setSmsDraft(e.target.value.slice(0, MAX_SMS_BODY_LENGTH))}
                      placeholder="Text message…"
                      rows={2}
                      className="min-h-[60px] flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="shrink-0"
                      disabled={smsSending || !smsDraft.trim()}
                      onClick={() => void sendSms()}
                    >
                      Send SMS
                    </Button>
                  </div>
                </>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Email</h3>
                <p className="text-xs text-muted-foreground">
                  Sends via Outlook when connected; otherwise Resend.
                </p>
              </div>
              {!emailSendEnabled ? (
                <SetupBanner
                  feature="Email"
                  detail="Connect Outlook in Settings or configure Resend to send from this tab."
                />
              ) : (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <Label htmlFor="email-to" className="text-[11px]">
                        To
                      </Label>
                      <Input
                        id="email-to"
                        type="email"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="email-subject" className="text-[11px]">
                        Subject
                      </Label>
                      <Input
                        id="email-subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                      />
                    </div>
                  </div>
                  <Textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Plain-text email body…"
                    rows={5}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      emailSending ||
                      !emailTo.trim() ||
                      !emailSubject.trim() ||
                      !emailBody.trim()
                    }
                    onClick={() => void sendEmail()}
                  >
                    {emailSending ? 'Sending…' : 'Send email'}
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Calls</h3>
                <p className="text-xs text-muted-foreground">
                  Logged Twilio and Retell calls for this matter.
                </p>
              </div>
              <CallList matterId={matter.matter_id} />
            </section>
          </TabsContent>

          <TabsContent value="activity">
            <MatterActivityTab activity={activity} loading={activityLoading} />
          </TabsContent>
        </Tabs>
      </div>

      <ImportIntakeDialog
        open={importIntakeOpen}
        onOpenChange={setImportIntakeOpen}
        accessToken={token}
        parseTextUrl={`/api/admin/matters/${matterId}/parse-intake`}
        parseDocxUrl={`/api/admin/matters/${matterId}/parse-intake-docx`}
        onParsed={(parsedIntakeId) => {
          setLiveIntakeId(parsedIntakeId)
          setIntakeCompleted(false)
          setImportIntakeOpen(false)
          setIntakeSheetOpen(true)
          router.refresh()
        }}
      />

      {intakeSheetOpen && (
        <AdminIntakeSheet
          leadId={null}
          matterId={matterId}
          clientIntakeId={liveIntakeId}
          clientUserId={clientIntakeRow?.client_user_id ?? clientIntakeRow?.user_id ?? null}
          practiceArea={matter.practice_area ?? 'Estate Planning'}
          clientName={matter.client_name || matter.matter_name || 'Client'}
          open={intakeSheetOpen}
          onClose={() => setIntakeSheetOpen(false)}
          onIntakeIdChange={setLiveIntakeId}
          onSubmitted={() => {
            setIntakeCompleted(true)
            setIntakeSheetOpen(false)
            router.refresh()
          }}
        />
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete matter?</DialogTitle>
            <DialogDescription>
              This permanently deletes <span className="font-medium text-foreground">{matterLabel}</span>,
              including intake, documents, design sheet, messages, and activity. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteMatter()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete matter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
