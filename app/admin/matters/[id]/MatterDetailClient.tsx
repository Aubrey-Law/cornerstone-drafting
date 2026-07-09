'use client'

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  FilePenLine,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { listDocuments } from '@/lib/documents'
import {
  STAGES,
  stageLabel,
  type MatterContact,
  type MatterDocument,
  type MatterStage,
  type PipelineMatter,
} from '@/types/database'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface MatterDetailClientProps {
  matter: PipelineMatter
  contacts: MatterContact[]
}

type ContactForm = {
  id?: string
  first_name: string
  last_name: string
  relationship: string
  email: string
  phone: string
}

const EMPTY_CONTACT: ContactForm = {
  first_name: '',
  last_name: '',
  relationship: '',
  email: '',
  phone: '',
}

function contactDisplayName(c: MatterContact) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function ComingSoonPanel({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-6 py-12 text-center">
      <Icon className="h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      <p className="text-xs text-muted-foreground">Coming soon</p>
    </div>
  )
}

export default function MatterDetailClient({
  matter: initialMatter,
  contacts: initialContacts,
}: MatterDetailClientProps) {
  const token = useAccessToken()
  const router = useRouter()
  const [matter, setMatter] = useState(initialMatter)
  const [contacts, setContacts] = useState(initialContacts)
  const [stageSaving, setStageSaving] = useState(false)
  const [sendingIntake, setSendingIntake] = useState(false)
  const [intakeUrl, setIntakeUrl] = useState<string | null>(null)
  const [documents, setDocuments] = useState<MatterDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactForm, setContactForm] = useState<ContactForm>(EMPTY_CONTACT)

  useEffect(() => {
    setMatter(initialMatter)
  }, [initialMatter])

  useEffect(() => {
    setContacts(initialContacts)
  }, [initialContacts])

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
      if (res.status === 404) {
        toast.message('Intake send is not available yet', {
          description: 'This endpoint will be fully wired in a later phase.',
        })
        return
      }
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

  const openAddContact = () => {
    setContactForm(EMPTY_CONTACT)
    setContactDialogOpen(true)
  }

  const openEditContact = (c: MatterContact) => {
    setContactForm({
      id: c.id,
      first_name: c.first_name ?? '',
      last_name: c.last_name ?? '',
      relationship: c.relationship ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
    })
    setContactDialogOpen(true)
  }

  const handleSaveContact = async () => {
    if (!token) {
      toast.error('Not signed in')
      return
    }
    const first = contactForm.first_name.trim()
    const last = contactForm.last_name.trim()
    if (!first || !last) {
      toast.error('First and last name are required')
      return
    }

    setContactSaving(true)
    try {
      const isEdit = Boolean(contactForm.id)
      const res = await fetch(`/api/admin/matters/${matter.matter_id}/design-sheet/contacts`, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: contactForm.id,
          first_name: first,
          last_name: last,
          relationship: contactForm.relationship.trim() || null,
          email: contactForm.email.trim() || null,
          phone: contactForm.phone.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not save contact')
      const saved = body.contact as MatterContact
      setContacts(current => {
        if (isEdit) return current.map(c => (c.id === saved.id ? saved : c))
        return [...current, saved].sort((a, b) =>
          (a.last_name ?? '').localeCompare(b.last_name ?? ''),
        )
      })
      setContactDialogOpen(false)
      toast.success(isEdit ? 'Contact updated' : 'Contact added')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save contact')
    } finally {
      setContactSaving(false)
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
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href={`/admin/drafting/${matter.matter_id}`}>
              <FilePenLine className="h-3.5 w-3.5" />
              Open drafting
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
        <Tabs defaultValue="overview" className="gap-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="communications">Communications</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
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

          <TabsContent value="contacts" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Household and related contacts for this matter.
              </p>
              <Button type="button" size="sm" onClick={openAddContact}>
                <Plus className="h-3.5 w-3.5" />
                Add contact
              </Button>
            </div>
            {contacts.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-xs text-muted-foreground">
                No contacts yet. Add a contact to get started.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Relationship</th>
                      <th className="hidden px-3 py-2 font-medium sm:table-cell">Email</th>
                      <th className="hidden px-3 py-2 font-medium md:table-cell">Phone</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map(c => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 font-medium">{contactDisplayName(c)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {c.relationship || '—'}
                        </td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">
                          {c.email || '—'}
                        </td>
                        <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">
                          {c.phone || '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditContact(c)}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="communications" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ComingSoonPanel
                title="Messages"
                description="In-app portal messages with the client will appear here."
                icon={MessageSquare}
              />
              <ComingSoonPanel
                title="SMS"
                description="Text message threads will be listed here."
                icon={MessageSquare}
              />
              <ComingSoonPanel
                title="Email"
                description="Email correspondence for this matter will show here."
                icon={Mail}
              />
              <ComingSoonPanel
                title="Calls"
                description="Call logs and notes will be available here."
                icon={Phone}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{contactForm.id ? 'Edit contact' : 'Add contact'}</DialogTitle>
            <DialogDescription>
              Contacts are stored on the matter intake household record.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="contact-first">First name</Label>
                <Input
                  id="contact-first"
                  value={contactForm.first_name}
                  onChange={e => setContactForm(f => ({ ...f, first_name: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contact-last">Last name</Label>
                <Input
                  id="contact-last"
                  value={contactForm.last_name}
                  onChange={e => setContactForm(f => ({ ...f, last_name: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-rel">Relationship</Label>
              <Input
                id="contact-rel"
                value={contactForm.relationship}
                onChange={e => setContactForm(f => ({ ...f, relationship: e.target.value }))}
                placeholder="Spouse, child, sibling…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-email">Email</Label>
              <Input
                id="contact-email"
                type="email"
                value={contactForm.email}
                onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input
                id="contact-phone"
                type="tel"
                value={contactForm.phone}
                onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setContactDialogOpen(false)}
              disabled={contactSaving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSaveContact()} disabled={contactSaving}>
              {contactSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
