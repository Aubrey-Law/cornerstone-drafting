'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CalendarPlus, Eye, FileText, Loader2, Paperclip, Send, Trash2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  emailHtmlIsEmpty,
  emailHtmlToText,
  RichTextEmailEditor,
} from '@/components/admin/RichTextEmailEditor'
import {
  renderEmailTemplateBodyHtml,
  renderEmailTemplateText,
  textToEmailHtml,
} from '@/lib/email/templateShared'
import { contactPickerKeyAction } from '@/lib/contactPickerKeyboard'
import { DraftWithAiButton } from '@/components/matter/DraftWithAiButton'
import { railRecordForPath } from './RailActivityPane'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

/**
 * Compose pane for the admin rail: a one-off email or one started from a
 * stored template, with attachments pulled from the matter's documents or
 * from the operator's computer.
 *
 * Sending goes through /api/admin/email/send, which also writes the matter or
 * lead activity entry when the rail is scoped to a record.
 */

interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
}

interface ComposeDocument {
  id: string
  name: string
  size: number | null
  folder: string | null
}

interface ComposeContext {
  // 'contact' is used by the contacts page for people with no lead or matter
  // behind them. Such a send carries neither matterId nor leadId.
  recordType: 'matter' | 'lead' | 'contact'
  recordId: string
  recipientName: string | null
  recipientEmail: string | null
  spouseName: string | null
  spouseEmail: string | null
  alternateEmails: { label: string; email: string }[]
  documents: ComposeDocument[]
}

interface DirectoryEntry {
  email: string
  name: string
  detail: string | null
}

interface SchedulingType {
  key: string
  label: string
  configured: boolean
  links: { email: string; sms: string; portal: string } | null
}

interface ScheduledEmailItem {
  id: string
  to: string
  subject: string
  scheduledFor: string
  timezone: string
  status: 'pending' | 'processing' | 'sent' | 'suppressed' | 'failed' | 'cancelled'
  attempts: number
  lastError: string | null
}

/** Mirrors MAX_TOTAL_ATTACHMENT_BYTES on the server. */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const ONE_OFF = 'none'
const VARIABLE_OPTIONS = [
  { key: 'first_name', label: 'First name' },
  { key: 'client_name', label: 'Client name' },
  { key: 'client_first_name', label: 'Client first name' },
  { key: 'lead_name', label: 'Lead name' },
  { key: 'spouse_name', label: 'Spouse name' },
  { key: 'spouse_first_name', label: 'Spouse first name' },
  { key: 'intake_link', label: 'Intake link' },
]
const UNRESOLVED_RE = /\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g

function defaultScheduleInput(): string {
  const value = new Date(Date.now() + 60 * 60_000)
  value.setSeconds(0, 0)
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 16)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** Cc accepts a comma- or semicolon-separated list. */
function parseAddressList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map(entry => entry.trim())
    .filter(Boolean)
}

/** Matches directory entries against the address fragment being typed. */
function matchDirectory(
  directory: DirectoryEntry[],
  fragment: string,
  exclude: string[],
): DirectoryEntry[] {
  const query = fragment.trim().toLowerCase()
  if (query.length < 2) return []
  const taken = new Set(exclude.map(address => address.toLowerCase()))
  return directory
    .filter(
      entry =>
        !taken.has(entry.email) &&
        (entry.name.toLowerCase().includes(query) ||
          entry.email.includes(query) ||
          (entry.detail?.toLowerCase().includes(query) ?? false)),
    )
    .slice(0, 6)
}

/**
 * One recipient field. `mode: 'single'` replaces the value on pick (To);
 * `mode: 'list'` appends to a comma-separated list (Cc/Bcc).
 */
function AddressField({
  id,
  label,
  value,
  onChange,
  invalid,
  hint,
  hideLabel = false,
  directory,
  mode,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  invalid: string[]
  hint?: string
  hideLabel?: boolean
  directory: DirectoryEntry[]
  mode: 'single' | 'list'
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  // In list mode only the fragment after the last separator is being typed.
  const parts = value.split(/[,;]/)
  const fragment = mode === 'single' ? value : (parts[parts.length - 1] ?? '')
  const committed = mode === 'single' ? [] : parts.slice(0, -1).map(part => part.trim()).filter(Boolean)
  const matches = open ? matchDirectory(directory, fragment, committed) : []

  useEffect(() => {
    setActiveIndex(0)
  }, [value])

  function choose(entry: DirectoryEntry) {
    onChange(mode === 'single' ? entry.email : [...committed, entry.email].join(', ') + ', ')
    setOpen(false)
  }

  return (
    <div className="relative space-y-1">
      <label
        htmlFor={id}
        className={cn('text-[11px] font-medium text-muted-foreground', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={`${id}-results`}
        onChange={event => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={event => {
          if (matches.length === 0) return
          const result = contactPickerKeyAction(event.key, activeIndex, matches.length, true)
          if (result.preventDefault) event.preventDefault()
          setActiveIndex(result.activeIndex)
          if (result.selectIndex !== null && matches[result.selectIndex]) {
            choose(matches[result.selectIndex])
          }
          if (!result.open) setOpen(false)
        }}
        placeholder={mode === 'single' ? 'name@example.com' : 'Separate addresses with commas'}
        aria-invalid={invalid.length > 0}
        className={cn(
          'h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:border-ring',
          invalid.length > 0 ? 'border-destructive' : 'border-input',
        )}
      />

      {matches.length > 0 && (
        <div
          id={`${id}-results`}
          role="listbox"
          aria-label={`${label} contact suggestions`}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          {matches.map((entry, index) => (
            <button
              key={entry.email}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(entry)}
              className={cn(
                'block w-full px-2.5 py-1.5 text-left',
                index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60',
              )}
            >
              <span className="block truncate text-xs font-medium">{entry.name}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {entry.email}
                {entry.detail ? ` · ${entry.detail}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {invalid.length > 0 ? (
        <p role="alert" className="text-[11px] text-destructive">
          Not a valid address: {invalid.join(', ')}
        </p>
      ) : (
        hint && <p className="text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

interface ManualEmailComposerProps {
  recordOverride?: { type: 'matter' | 'lead' | 'contact'; id: string } | null
  templateCategories?: string[]
  onSent?: () => void | Promise<void>
  embedded?: boolean
  variableValues?: Record<string, string | null | undefined>
  initialContext?: ComposeContext
}

export function ManualEmailComposer({
  recordOverride,
  templateCategories = ['manual'],
  onSent,
  embedded = false,
  variableValues = {},
  initialContext,
}: ManualEmailComposerProps = {}) {
  const pathname = usePathname()
  const record = recordOverride === undefined ? railRecordForPath(pathname) : recordOverride
  const token = useAccessToken()

  const [context, setContext] = useState<ComposeContext | null>(null)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [templateId, setTemplateId] = useState(ONE_OFF)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [showDocumentPicker, setShowDocumentPicker] = useState(false)
  const [directory, setDirectory] = useState<DirectoryEntry[]>([])
  const [schedulingTypes, setSchedulingTypes] = useState<SchedulingType[]>([])
  const [showSchedulingPicker, setShowSchedulingPicker] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentNotice, setSentNotice] = useState<string | null>(null)
  const [includeSignature, setIncludeSignature] = useState(true)
  const [hasSignature, setHasSignature] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleInput)
  const [scheduling, setScheduling] = useState(false)
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmailItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftExistedRef = useRef(false)
  const defaultRecipientRef = useRef('')

  const recordType = record?.type ?? null
  const recordId = record?.id ?? null
  const templateCategoryKey = templateCategories.join(',')
  const firstName = context?.recipientName?.trim().split(/\s+/)[0] ?? ''
  const spouseName = context?.spouseName ?? ''
  const spouseFirstName = spouseName.trim().split(/\s+/)[0] ?? ''
  const resolvedVariables: Record<string, string | null | undefined> = {
    client_name: context?.recipientName ?? '',
    client_first_name: firstName,
    first_name: firstName,
    lead_name: context?.recipientName ?? '',
    spouse_name: spouseName,
    spouse_first_name: spouseFirstName,
    ...variableValues,
  }
  const resolvedVariableOptions = VARIABLE_OPTIONS.map(option => ({
    ...option,
    value: resolvedVariables[option.key] ?? undefined,
  }))

  // Drafting needs a record to read context from, so the button only exists
  // when the pane is scoped to one. A bare contact has no such context.
  const draftRoute = record?.type === 'matter'
    ? `/api/admin/matters/${record.id}/draft-reply`
    : record?.type === 'lead'
      ? `/api/admin/leads/${record.id}/draft-reply`
      : null

  /** Both draft routes answer with "Subject: …" on line one, then the body. */
  function applyAiDraft(draft: string) {
    const match = draft.match(/^Subject:\s*(.+)\n+([\s\S]*)$/)
    const nextSubject = match ? match[1].trim() : ''
    const nextBody = match ? match[2].trim() : draft.trim()
    setSubject(nextSubject || 'Follow-up')
    setBodyHtml(textToEmailHtml(nextBody))
    // An AI draft is the operator's own words now, not a template render.
    setTemplateId(ONE_OFF)
  }

  useEffect(() => {
    if (initialContext) {
      setContext(initialContext)
      defaultRecipientRef.current = initialContext.recipientEmail ?? ''
      setTo(value => value || initialContext.recipientEmail || '')
      return
    }
    // Only leads and matters have a compose context to fetch; a contact-scoped
    // pane is always given one via `initialContext`.
    if (recordType !== 'matter' && recordType !== 'lead') {
      setContext(null)
      return
    }
    if (!recordId) {
      setContext(null)
      return
    }
    let cancelled = false
    const query = recordType === 'matter' ? `matterId=${recordId}` : `leadId=${recordId}`
    void (async () => {
      try {
        const res = await fetch(`/api/admin/email/compose-context?${query}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const body = (await res.json()) as { context?: ComposeContext | null }
        if (cancelled || !body.context) return
        setContext(body.context)
        defaultRecipientRef.current = body.context.recipientEmail ?? ''
        // Always re-derive: the pane stays mounted across records, so a stale
        // `to` from the last matter would otherwise stick to the next one.
        setTo(body.context.recipientEmail ?? '')
      } catch {
        /* the pane still works as a blank one-off */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialContext, recordType, recordId, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const groups = await Promise.all(templateCategoryKey.split(',').filter(Boolean).map(async category => {
          const res = await fetch(`/api/admin/settings/email/templates?category=${category}&active=true`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          const body = (await res.json()) as { templates?: EmailTemplate[] }
          return Array.isArray(body.templates) ? body.templates : []
        }))
        const unique = new Map(groups.flat().map(template => [template.id, template]))
        if (!cancelled) setTemplates([...unique.values()])
      } catch {
        /* templates are optional — a one-off email still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [templateCategoryKey, token])

  const draftContextType = recordType ?? 'general'
  const draftQuery = `contextType=${draftContextType}${recordId ? `&contextId=${encodeURIComponent(recordId)}` : ''}`

  useEffect(() => {
    if (!scheduleOpen || !token) return
    let cancelled = false
    void fetch(`/api/admin/email/scheduled?${draftQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(body => {
        if (!cancelled) setScheduledEmails(Array.isArray(body.scheduled) ? body.scheduled : [])
      })
      .catch(() => {
        if (!cancelled) setScheduledEmails([])
      })
    return () => { cancelled = true }
  }, [draftQuery, scheduleOpen, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setDraftReady(false)
    setTo('')
    setCc('')
    setBcc('')
    setShowCc(false)
    setShowBcc(false)
    setTemplateId(ONE_OFF)
    setSubject('')
    setBodyHtml('')
    setSelectedDocumentIds([])
    setFiles([])
    void Promise.all([
      fetch('/api/admin/settings/email/signature', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json()),
      fetch(`/api/admin/email/draft?${draftQuery}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json()),
    ]).then(([signatureBody, draftBody]) => {
      if (cancelled) return
      const signature = signatureBody.signature as { html?: string; includeByDefault?: boolean } | undefined
      setHasSignature(Boolean(signature?.html?.trim()))
      const draft = draftBody.draft as {
        to?: string; cc?: string[]; bcc?: string[]; templateId?: string | null; subject?: string
        bodyHtml?: string; documentIds?: string[]; includeSignature?: boolean
      } | null
      if (draft) {
        draftExistedRef.current = true
        setTo(draft.to ?? '')
        setCc((draft.cc ?? []).join(', '))
        setBcc((draft.bcc ?? []).join(', '))
        setShowCc((draft.cc?.length ?? 0) > 0)
        setShowBcc((draft.bcc?.length ?? 0) > 0)
        setTemplateId(draft.templateId ?? ONE_OFF)
        setSubject(draft.subject ?? '')
        setBodyHtml(draft.bodyHtml ?? '')
        setSelectedDocumentIds(draft.documentIds ?? [])
        setIncludeSignature(draft.includeSignature !== false)
        setDraftStatus('saved')
      } else {
        draftExistedRef.current = false
        setTo(value => value || defaultRecipientRef.current)
        setIncludeSignature(signature?.includeByDefault !== false)
        setDraftStatus('idle')
      }
      setDraftReady(true)
    }).catch(() => {
      if (!cancelled) {
        setDraftReady(true)
        setDraftStatus('error')
      }
    })
    return () => { cancelled = true }
  }, [draftQuery, initialContext?.recipientEmail, token])

  // Switching records swaps the recipients and clears anything record-scoped.
  // Subject and body are the operator's own words, so they survive the move.
  useEffect(() => {
    setSelectedDocumentIds([])
    setShowDocumentPicker(false)
    setShowSchedulingPicker(false)
    setCc('')
    setBcc('')
    setShowCc(false)
    setShowBcc(false)
    setSentNotice(null)
    if (!recordId) setTo('')
  }, [recordId])

  // Firm-wide address book for the To/Cc/Bcc typeahead.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/email/directory', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = (await res.json()) as { entries?: DirectoryEntry[] }
        if (!cancelled && Array.isArray(body.entries)) setDirectory(body.entries)
      } catch {
        /* the fields still accept a typed address without the directory */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  // Scheduling links for the record in context, so a booking URL can be
  // dropped into the body without leaving the pane.
  useEffect(() => {
    setSchedulingTypes([])
    if ((recordType !== 'matter' && recordType !== 'lead') || !recordId || !token) return
    let cancelled = false
    const query = recordType === 'matter' ? `matterId=${recordId}` : `leadId=${recordId}`
    void (async () => {
      try {
        const res = await fetch(`/api/admin/scheduling-links/send?${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const body = (await res.json()) as { types?: SchedulingType[] }
        if (cancelled || !Array.isArray(body.types)) return
        setSchedulingTypes(body.types.filter(type => type.configured && type.links))
      } catch {
        /* scheduling links are optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordType, recordId, token])

  function chooseTemplate(id: string) {
    setTemplateId(id)
    if (id === ONE_OFF) {
      setSubject('')
      setBodyHtml('')
      return
    }
    const template = templates.find(row => row.id === id)
    if (!template) return
    setSubject(renderEmailTemplateText(template.subject, resolvedVariables))
    setBodyHtml(renderEmailTemplateBodyHtml(template.body, resolvedVariables))
  }

  function insertSchedulingLink(type: SchedulingType) {
    const url = type.links?.email
    if (!url) return
    // The URL is the anchor text, not just the href: the plain-text alternative
    // is produced by stripping tags, so a worded link would arrive with no
    // address at all for anyone reading text/plain. `&` is entity-escaped so the
    // html-to-text pass restores it intact.
    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const anchor = `<p>Schedule your ${escapeHtmlText(type.label.toLowerCase())}: <a href="${safeUrl}">${safeUrl}</a></p>`
    setBodyHtml(prev => (prev?.trim() ? `${prev}${anchor}` : anchor))
    setShowSchedulingPicker(false)
  }



  const selectedDocuments = useMemo(
    () => (context?.documents ?? []).filter(doc => selectedDocumentIds.includes(doc.id)),
    [context, selectedDocumentIds],
  )

  const totalBytes =
    files.reduce((sum, file) => sum + file.size, 0) +
    selectedDocuments.reduce((sum, doc) => sum + (doc.size ?? 0), 0)
  const overLimit = totalBytes > MAX_TOTAL_BYTES
  const attachmentCount = files.length + selectedDocuments.length

  const ccList = useMemo(() => parseAddressList(cc), [cc])
  const bccList = useMemo(() => parseAddressList(bcc), [bcc])
  const invalidTo = to.trim() && !isEmail(to.trim()) ? [to.trim()] : []
  const invalidCc = ccList.filter(address => !isEmail(address))
  const invalidBcc = bccList.filter(address => !isEmail(address))
  const unresolved = [...new Set(`${subject}\n${bodyHtml}`.match(UNRESOLVED_RE) ?? [])]
  const mentionsAttachment = /\battach(?:ed|ment|ments|ing)?\b/i.test(emailHtmlToText(bodyHtml))
  const hasDraftContent = Boolean(cc || bcc || subject || !emailHtmlIsEmpty(bodyHtml) || selectedDocumentIds.length)

  const ready =
    isEmail(to.trim()) &&
    Boolean(subject.trim()) &&
    !emailHtmlIsEmpty(bodyHtml) &&
    !overLimit &&
    invalidCc.length === 0 &&
    invalidBcc.length === 0 &&
    unresolved.length === 0

  useEffect(() => {
    if (!token || !draftReady || sending) return
    if (!hasDraftContent) {
      if (draftExistedRef.current) {
        void fetch(`/api/admin/email/draft?${draftQuery}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).then(() => {
          draftExistedRef.current = false
          setDraftStatus('idle')
        }).catch(() => setDraftStatus('error'))
      }
      return
    }
    setDraftStatus('saving')
    const timeout = window.setTimeout(() => {
      void fetch(`/api/admin/email/draft?${draftQuery}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to, cc: ccList, bcc: bccList, templateId, subject, bodyHtml,
          documentIds: selectedDocumentIds, includeSignature,
        }),
      }).then(res => {
        if (res.ok) draftExistedRef.current = true
        setDraftStatus(res.ok ? 'saved' : 'error')
      }).catch(() => setDraftStatus('error'))
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [
    bccList, bodyHtml, ccList, draftQuery, draftReady, hasDraftContent, includeSignature,
    selectedDocumentIds, sending, subject, templateId, to, token,
  ])

  async function discardDraft() {
    if (!token || !window.confirm('Discard this email draft?')) return
    await fetch(`/api/admin/email/draft?${draftQuery}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    draftExistedRef.current = false
    setTo(context?.recipientEmail ?? '')
    setCc(''); setBcc(''); setSubject(''); setBodyHtml(''); setTemplateId(ONE_OFF)
    setSelectedDocumentIds([]); setFiles([]); setDraftStatus('idle')
  }

  async function preview() {
    if (!token) return
    setPreviewing(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/email/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, html: bodyHtml, text: emailHtmlToText(bodyHtml), includeSignature }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not build preview')
      setPreviewHtml(body.html ?? '')
      setPreviewOpen(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not build preview')
    } finally {
      setPreviewing(false)
    }
  }

  async function scheduleEmail() {
    if (!token || !ready || files.length > 0 || scheduling) return
    const scheduledFor = new Date(scheduleAt)
    if (!Number.isFinite(scheduledFor.getTime())) {
      setError('Choose a valid send time')
      return
    }
    setScheduling(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/email/scheduled', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contextType: draftContextType,
          contextId: recordId,
          to: to.trim(),
          cc: ccList,
          bcc: bccList,
          subject: subject.trim(),
          html: bodyHtml,
          text: emailHtmlToText(bodyHtml),
          documentIds: selectedDocumentIds,
          includeSignature,
          scheduledFor: scheduledFor.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
        }),
      })
      const response = await res.json().catch(() => ({})) as { error?: string; scheduled?: ScheduledEmailItem }
      if (!res.ok) throw new Error(response.error ?? 'Could not schedule email')
      if (response.scheduled) setScheduledEmails(items => [response.scheduled!, ...items])
      setSentNotice(`Email scheduled for ${scheduledFor.toLocaleString()}.`)
      setSubject('')
      setBodyHtml('')
      setTemplateId(ONE_OFF)
      setCc('')
      setBcc('')
      setShowCc(false)
      setShowBcc(false)
      setSelectedDocumentIds([])
      setDraftStatus('idle')
      draftExistedRef.current = false
      await fetch(`/api/admin/email/draft?${draftQuery}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      setScheduleAt(defaultScheduleInput())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not schedule email')
    } finally {
      setScheduling(false)
    }
  }

  async function cancelScheduled(id: string) {
    if (!token) return
    const res = await fetch(`/api/admin/email/scheduled/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      setScheduledEmails(items => items.map(item => item.id === id ? { ...item, status: 'cancelled' } : item))
    }
  }

  async function send() {
    if (!ready || sending) return
    setSending(true)
    setError(null)
    setSentNotice(null)
    try {
      const form = new FormData()
      form.set(
        'payload',
        JSON.stringify({
          to: to.trim(),
          cc: ccList,
          bcc: bccList,
          subject: subject.trim(),
          html: bodyHtml,
          text: emailHtmlToText(bodyHtml),
          matterId: context?.recordType === 'matter' ? context.recordId : undefined,
          leadId: context?.recordType === 'lead' ? context.recordId : undefined,
          contactId: context?.recordType === 'contact' ? context.recordId : undefined,
          documentIds: selectedDocumentIds,
          includeSignature,
        }),
      )
      for (const file of files) form.append('files', file)

      const res = await fetch('/api/admin/email/send', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string }
      if (!res.ok) throw new Error(body.error || 'Could not send the email')
      if (body.status !== 'sent' && body.status !== 'redirected') {
        setSentNotice(`Email was ${body.status ?? 'not sent'}; the draft was retained.`)
        return
      }

      setSentNotice(
        attachmentCount > 0
          ? `Sent to ${to.trim()} with ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}.`
          : `Sent to ${to.trim()}.`,
      )
      setSubject('')
      setBodyHtml('')
      setTemplateId(ONE_OFF)
      setCc('')
      setBcc('')
      setShowCc(false)
      setShowBcc(false)
      setFiles([])
      setSelectedDocumentIds([])
      setDraftStatus('idle')
      if (token) {
        await fetch(`/api/admin/email/draft?${draftQuery}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
      draftExistedRef.current = false
      await onSent?.()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col', embedded ? 'max-h-[75dvh]' : 'h-full')}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="rail-email-to" className="text-[11px] font-medium text-muted-foreground">
              To
            </label>
            <span className="flex items-center gap-2">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-accent"
                >
                  Cc
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => setShowBcc(true)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-accent"
                >
                  Bcc
                </button>
              )}
            </span>
          </div>
          <AddressField
            id="rail-email-to"
            label="To"
            hideLabel
            value={to}
            onChange={setTo}
            invalid={invalidTo}
            directory={directory}
            mode="single"
          />
          {(context?.alternateEmails.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {context!.alternateEmails.map(option => (
                <span key={option.email} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTo(option.email)}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-accent hover:text-accent"
                  >
                    {option.label}
                  </button>
                  <button
                    type="button"
                    aria-label={`Cc ${option.label}`}
                    onClick={() => {
                      setShowCc(true)
                      setCc(prev =>
                        parseAddressList(prev).includes(option.email)
                          ? prev
                          : [...parseAddressList(prev), option.email].join(', '),
                      )
                    }}
                    className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-accent hover:text-accent"
                  >
                    +cc
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {showCc && (
          <AddressField
            id="rail-email-cc"
            label="Cc"
            value={cc}
            onChange={setCc}
            invalid={invalidCc}
            directory={directory}
            mode="list"
          />
        )}

        {showBcc && (
          <AddressField
            id="rail-email-bcc"
            label="Bcc"
            value={bcc}
            onChange={setBcc}
            invalid={invalidBcc}
            directory={directory}
            mode="list"
            hint="Blind recipients — the other recipients will not see these."
          />
        )}

        <div className="space-y-1">
          <label htmlFor="rail-email-template" className="text-[11px] font-medium text-muted-foreground">
            Template
          </label>
          <select
            id="rail-email-template"
            value={templateId}
            onChange={event => chooseTemplate(event.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
          >
            <option value={ONE_OFF}>One-off email</option>
            {templates.map(template => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="rail-email-subject" className="text-[11px] font-medium text-muted-foreground">
              Subject
            </label>
            {draftRoute && (
              <DraftWithAiButton
                apiPath={draftRoute}
                channel="email"
                notes={emailHtmlToText(bodyHtml)}
                onDraft={applyAiDraft}
              />
            )}
            <select
              aria-label="Insert subject variable"
              defaultValue=""
              onChange={event => {
                const option = resolvedVariableOptions.find(item => item.key === event.target.value)
                if (option) setSubject(value => `${value}${option.value || `{{${option.key}}}`}`)
                event.target.value = ''
              }}
              className="h-6 rounded border border-input bg-background px-1 text-[10px]"
            >
              <option value="">Insert variable…</option>
              {resolvedVariableOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </div>
          <input
            id="rail-email-subject"
            value={subject}
            onChange={event => setSubject(event.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Message</span>
            {schedulingTypes.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSchedulingPicker(prev => !prev)}
                  aria-expanded={showSchedulingPicker}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-accent"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  Scheduling link
                </button>
                {showSchedulingPicker && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-md border border-border bg-card shadow-lg">
                    {schedulingTypes.map(type => (
                      <button
                        key={type.key}
                        type="button"
                        onClick={() => insertSchedulingLink(type)}
                        className="block w-full px-2.5 py-1.5 text-left text-[11px] hover:bg-muted"
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <RichTextEmailEditor
            id="rail-email-body"
            ariaLabel="Message"
            valueHtml={bodyHtml}
            onChange={setBodyHtml}
            disabled={sending}
            placeholder="Write your message"
            variableOptions={resolvedVariableOptions}
          />
        </div>

        {unresolved.length > 0 && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
            Resolve or remove: {unresolved.join(', ')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className={cn('flex items-center gap-2 text-xs', !hasSignature && 'text-muted-foreground')}>
            <Checkbox
              checked={includeSignature}
              disabled={!hasSignature}
              onCheckedChange={checked => setIncludeSignature(checked === true)}
            />
            Include signature
          </label>
          {!hasSignature && <span className="text-[10px] text-muted-foreground">Configure it in Settings → Templates.</span>}
          <Button type="button" variant="outline" size="sm" className="ml-auto h-7 text-xs" disabled={previewing || emailHtmlIsEmpty(bodyHtml)} onClick={() => void preview()}>
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Preview
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Attachments</span>
            {attachmentCount > 0 && (
              <span className={cn('text-[10px]', overLimit ? 'text-destructive' : 'text-muted-foreground')}>
                {attachmentCount} · {formatBytes(totalBytes)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {context?.recordType === 'matter' && (
              <button
                type="button"
                onClick={() => setShowDocumentPicker(prev => !prev)}
                aria-expanded={showDocumentPicker}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-medium hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5" />
                From documents
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-medium hover:bg-muted"
            >
              <Upload className="h-3.5 w-3.5" />
              From computer
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Attach files from your computer"
              onChange={event => {
                setFiles(prev => [...prev, ...Array.from(event.target.files ?? [])])
                event.target.value = ''
              }}
            />
          </div>

          {showDocumentPicker && context?.recordType === 'matter' && (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border">
              {context.documents.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                  This matter has no documents yet.
                </p>
              ) : (
                context.documents.map(doc => (
                  <label
                    key={doc.id}
                    className="flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-[11px] hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDocumentIds.includes(doc.id)}
                      onChange={event =>
                        setSelectedDocumentIds(prev =>
                          event.target.checked
                            ? [...prev, doc.id]
                            : prev.filter(id => id !== doc.id),
                        )
                      }
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{doc.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        {[doc.folder, doc.size ? formatBytes(doc.size) : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          )}

          {(selectedDocuments.length > 0 || files.length > 0) && (
            <ul className="space-y-1">
              {selectedDocuments.map(doc => (
                <li
                  key={doc.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDocumentIds(prev => prev.filter(id => id !== doc.id))}
                    aria-label={`Remove ${doc.name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px]"
                >
                  <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{formatBytes(file.size)}</span>
                  <button
                    type="button"
                    onClick={() => setFiles(prev => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${file.name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {overLimit && (
            <p role="alert" className="text-[11px] text-destructive">
              Attachments total {formatBytes(totalBytes)} — the limit is {formatBytes(MAX_TOTAL_BYTES)}.
            </p>
          )}
          {files.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Files from this computer must be reattached after a refresh. Linked matter documents are restored.
            </p>
          )}
          {mentionsAttachment && attachmentCount === 0 && (
            <p className="text-[11px] text-amber-700">
              This message mentions an attachment, but none is selected.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
            {error}
          </p>
        )}
        {sentNotice && (
          <p role="status" className="rounded-md border border-green bg-green-bg px-2.5 py-1.5 text-[11px] text-green">
            {sentNotice}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
        <span className="truncate text-[11px] text-muted-foreground">
          <span>
            {context?.recordType === 'matter'
              ? 'Logs to the matter timeline'
              : context?.recordType === 'lead'
                ? 'Logs to the lead timeline'
                : 'Not linked to a record'}
          </span>
          {draftStatus !== 'idle' && (
            <span>{draftStatus === 'saving' ? ' · Saving…' : draftStatus === 'saved' ? ' · Draft saved' : ' · Draft save failed'}</span>
          )}
        </span>
        {hasDraftContent && (
          <button type="button" onClick={() => void discardDraft()} aria-label="Discard email draft" className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setScheduleOpen(true)}
          disabled={!ready || sending || files.length > 0}
          title={files.length > 0 ? 'Remove computer uploads before scheduling' : 'Schedule send'}
          className="ml-auto h-8 text-xs"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Schedule
        </Button>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready || sending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? 'Sending…' : embedded ? 'Send email' : 'Send'}
        </button>
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Email preview</DialogTitle>
            <DialogDescription>{subject || 'No subject'}</DialogDescription>
          </DialogHeader>
          <iframe
            title="Rendered email preview"
            srcDoc={previewHtml}
            sandbox=""
            className="h-[60dvh] w-full rounded-md border border-border bg-white"
          />
        </DialogContent>
      </Dialog>
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Schedule email</DialogTitle>
            <DialogDescription>
              Times are shown in {Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'}.
              Computer uploads cannot be scheduled; linked matter documents can.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="scheduled-email-time">Send date and time</Label>
              <Input
                id="scheduled-email-time"
                type="datetime-local"
                value={scheduleAt}
                min={defaultScheduleInput().slice(0, 10) + 'T00:00'}
                onChange={event => setScheduleAt(event.target.value)}
              />
            </div>
            <Button type="button" className="w-full" disabled={scheduling} onClick={() => void scheduleEmail()}>
              {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              {scheduling ? 'Scheduling…' : 'Schedule email'}
            </Button>
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold">Scheduled email status</p>
              {scheduledEmails.length === 0 ? (
                <p className="text-xs text-muted-foreground">No scheduled emails for this record.</p>
              ) : (
                scheduledEmails.map(item => (
                  <div key={item.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{item.subject}</p>
                      <p className="text-muted-foreground">
                        {new Date(item.scheduledFor).toLocaleString()} · {item.status}
                        {item.lastError ? ` · ${item.lastError}` : ''}
                      </p>
                    </div>
                    {item.status === 'pending' && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => void cancelScheduled(item.id)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function RailEmailPane() {
  return <ManualEmailComposer />
}
