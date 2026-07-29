'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, Paperclip, Send, Upload, X } from 'lucide-react'
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
} from '@/lib/email/templateShared'
import { railRecordForPath } from './RailActivityPane'

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
  recordType: 'matter' | 'lead'
  recordId: string
  recipientName: string | null
  recipientEmail: string | null
  alternateEmails: { label: string; email: string }[]
  documents: ComposeDocument[]
}

/** Mirrors MAX_TOTAL_ATTACHMENT_BYTES on the server. */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const ONE_OFF = 'none'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

export function RailEmailPane() {
  const pathname = usePathname()
  const record = railRecordForPath(pathname)
  const token = useAccessToken()

  const [context, setContext] = useState<ComposeContext | null>(null)
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [templateId, setTemplateId] = useState(ONE_OFF)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [showDocumentPicker, setShowDocumentPicker] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentNotice, setSentNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const recordType = record?.type ?? null
  const recordId = record?.id ?? null

  useEffect(() => {
    if (!recordType || !recordId) {
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
        setTo(prev => prev || body.context!.recipientEmail || '')
      } catch {
        /* the pane still works as a blank one-off */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [recordType, recordId, token])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/admin/settings/email/templates?category=manual&active=true', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const body = (await res.json()) as { templates?: EmailTemplate[] }
        if (!cancelled && Array.isArray(body.templates)) setTemplates(body.templates)
      } catch {
        /* templates are optional — a one-off email still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  // Switching records swaps the recipient and clears anything matter-scoped.
  useEffect(() => {
    setSelectedDocumentIds([])
    setShowDocumentPicker(false)
  }, [recordId])

  function chooseTemplate(id: string) {
    setTemplateId(id)
    if (id === ONE_OFF) {
      setSubject('')
      setBodyHtml('')
      return
    }
    const template = templates.find(row => row.id === id)
    if (!template) return
    const firstName = context?.recipientName?.trim().split(/\s+/)[0] ?? ''
    const variables = {
      client_name: context?.recipientName ?? '',
      client_first_name: firstName,
      first_name: firstName,
      lead_name: context?.recipientName ?? '',
    }
    setSubject(renderEmailTemplateText(template.subject, variables))
    setBodyHtml(renderEmailTemplateBodyHtml(template.body, variables))
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
  const invalidCc = ccList.filter(address => !isEmail(address))

  const ready =
    Boolean(to.trim()) &&
    Boolean(subject.trim()) &&
    !emailHtmlIsEmpty(bodyHtml) &&
    !overLimit &&
    invalidCc.length === 0

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
          subject: subject.trim(),
          html: bodyHtml,
          text: emailHtmlToText(bodyHtml),
          matterId: context?.recordType === 'matter' ? context.recordId : undefined,
          leadId: context?.recordType === 'lead' ? context.recordId : undefined,
          documentIds: selectedDocumentIds,
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

      setSentNotice(
        attachmentCount > 0
          ? `Sent to ${to.trim()} with ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}.`
          : `Sent to ${to.trim()}.`,
      )
      setSubject('')
      setBodyHtml('')
      setTemplateId(ONE_OFF)
      setCc('')
      setShowCc(false)
      setFiles([])
      setSelectedDocumentIds([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send the email')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="rail-email-to" className="text-[11px] font-medium text-muted-foreground">
              To
            </label>
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="text-[11px] font-medium text-muted-foreground hover:text-accent"
              >
                Cc
              </button>
            )}
          </div>
          <input
            id="rail-email-to"
            type="email"
            value={to}
            onChange={event => setTo(event.target.value)}
            placeholder="name@example.com"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
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
          <div className="space-y-1">
            <label htmlFor="rail-email-cc" className="text-[11px] font-medium text-muted-foreground">
              Cc
            </label>
            <input
              id="rail-email-cc"
              value={cc}
              onChange={event => setCc(event.target.value)}
              placeholder="Separate addresses with commas"
              aria-invalid={invalidCc.length > 0}
              className={cn(
                'h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:border-ring',
                invalidCc.length > 0 ? 'border-destructive' : 'border-input',
              )}
            />
            {invalidCc.length > 0 && (
              <p role="alert" className="text-[11px] text-destructive">
                Not a valid address: {invalidCc.join(', ')}
              </p>
            )}
          </div>
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
          <label htmlFor="rail-email-subject" className="text-[11px] font-medium text-muted-foreground">
            Subject
          </label>
          <input
            id="rail-email-subject"
            value={subject}
            onChange={event => setSubject(event.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
          />
        </div>

        <div className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Message</span>
          <RichTextEmailEditor
            id="rail-email-body"
            ariaLabel="Message"
            valueHtml={bodyHtml}
            onChange={setBodyHtml}
            disabled={sending}
            placeholder="Write your message"
          />
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
          {context?.recordType === 'matter'
            ? 'Logs to the matter timeline'
            : context?.recordType === 'lead'
              ? 'Logs to the lead timeline'
              : 'Not linked to a record'}
        </span>
        <button
          type="button"
          onClick={() => void send()}
          disabled={!ready || sending}
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
