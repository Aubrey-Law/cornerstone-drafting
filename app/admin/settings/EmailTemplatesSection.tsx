'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Edit2, Eye, EyeOff, Plus, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { RichTextEmailEditor, emailHtmlIsEmpty } from '@/components/admin/RichTextEmailEditor'
import {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_META,
  type EmailCategory,
} from '@/lib/email/categories'
import { isHtmlTemplateBody, sanitizeEmailHtml, textToEmailHtml } from '@/lib/email/templateShared'

interface EmailTemplateRow {
  id: string
  name: string
  category: EmailCategory
  categoryLabel?: string
  subject: string
  body: string
  isActive: boolean
  isDefault: boolean
  updatedAt: string | null
}

interface TemplateFormState {
  id: string | null
  name: string
  category: EmailCategory
  subject: string
  body: string
  isActive: boolean
  isDefault: boolean
}

const EMPTY_FORM: TemplateFormState = {
  id: null,
  name: '',
  category: 'manual',
  subject: '',
  body: '',
  isActive: true,
  isDefault: false,
}

/** Render text with {{placeholder}} tokens highlighted as accent chips. Plain text only — never injects HTML. */
function PlaceholderText({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[\w.]+\s*\}\})/g)
  return (
    <>
      {parts.map((part, i) =>
        /^\{\{\s*[\w.]+\s*\}\}$/.test(part) ? (
          <span
            key={i}
            className="mx-0.5 inline-block rounded bg-accent/10 px-1 py-px font-mono text-[0.85em] font-medium text-accent"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

function formatTemplateDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function EmailTemplatesSection({ authHeaders }: { authHeaders?: HeadersInit }) {
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<EmailTemplateRow | null>(null)
  const [signatureHtml, setSignatureHtml] = useState('')
  const [signatureDefault, setSignatureDefault] = useState(true)
  const [signatureSaving, setSignatureSaving] = useState(false)
  const [showSignaturePreview, setShowSignaturePreview] = useState(false)

  const groupedTemplates = useMemo(() => {
    const map = new Map<EmailCategory, EmailTemplateRow[]>()
    for (const template of templates) {
      const group = map.get(template.category) ?? []
      group.push(template)
      map.set(template.category, group)
    }
    return map
  }, [templates])

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings/email/templates', {
        cache: 'no-store',
        headers: authHeaders,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not load templates')
      setTemplates((json.templates ?? []) as EmailTemplateRow[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load templates')
    } finally {
      setLoading(false)
    }
  }, [authHeaders])

  useEffect(() => {
    void loadTemplates()
    void (async () => {
      try {
        const res = await fetch('/api/admin/settings/email/signature', { cache: 'no-store', headers: authHeaders })
        const json = await res.json().catch(() => ({})) as {
          signature?: { html?: string; includeByDefault?: boolean }
        }
        if (!res.ok) throw new Error('Could not load email signature')
        setSignatureHtml(json.signature?.html ?? '')
        setSignatureDefault(json.signature?.includeByDefault !== false)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not load email signature')
      }
    })()
  }, [authHeaders, loadTemplates])

  async function saveSignature() {
    setSignatureSaving(true)
    try {
      const res = await fetch('/api/admin/settings/email/signature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(authHeaders ?? {}) },
        body: JSON.stringify({ html: signatureHtml, includeByDefault: signatureDefault }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not save email signature')
      toast.success(signatureHtml.trim() ? 'Email signature saved' : 'Email signature cleared')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save email signature')
    } finally {
      setSignatureSaving(false)
    }
  }

  function editTemplate(template: EmailTemplateRow) {
    setForm({
      id: template.id,
      name: template.name,
      category: template.category,
      subject: template.subject,
      // Legacy plain-text bodies are upgraded to HTML so the rich editor shows
      // their paragraphs/line breaks; re-saving then stores them as HTML.
      body: isHtmlTemplateBody(template.body) ? template.body : textToEmailHtml(template.body),
      isActive: template.isActive,
      isDefault: template.isDefault,
    })
  }

  async function saveTemplate() {
    if (!form.name.trim() || !form.subject.trim() || emailHtmlIsEmpty(form.body)) {
      toast.error('Name, subject, and body are required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(
        form.id
          ? `/api/admin/settings/email/templates/${form.id}`
          : '/api/admin/settings/email/templates',
        {
          method: form.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', ...(authHeaders ?? {}) },
          body: JSON.stringify({
            name: form.name,
            category: form.category,
            subject: form.subject,
            body: form.body,
            isActive: form.isActive,
            isDefault: form.isDefault,
          }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save template')
      toast.success(form.id ? 'Template updated' : 'Template created')
      setForm(EMPTY_FORM)
      await loadTemplates()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save template')
    } finally {
      setSaving(false)
    }
  }

  async function deleteTemplate(template: EmailTemplateRow) {
    try {
      const res = await fetch(`/api/admin/settings/email/templates/${template.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not delete template')
      toast.success('Template deleted')
      if (form.id === template.id) setForm(EMPTY_FORM)
      await loadTemplates()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete template')
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="mb-6 space-y-3 rounded-md border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">Email Signature</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Firm-wide signature offered on manual emails. Automated notices are unchanged.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={showSignaturePreview}
            onClick={() => setShowSignaturePreview(value => !value)}
          >
            {showSignaturePreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showSignaturePreview ? 'Hide preview' : 'Preview'}
          </Button>
        </div>
        <RichTextEmailEditor
          id="email-signature"
          ariaLabel="Firm email signature"
          valueHtml={signatureHtml}
          onChange={setSignatureHtml}
          placeholder="Attorney name, title, phone, and website"
        />
        {showSignaturePreview && (
          <div
            className="rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed [&_a]:text-accent [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(signatureHtml) || '<span>No signature configured.</span>' }}
          />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={signatureDefault} onCheckedChange={checked => setSignatureDefault(checked === true)} />
            Include this signature by default
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => setSignatureHtml('')}>
            Clear
          </Button>
          <Button type="button" size="sm" className="ml-auto" disabled={signatureSaving} onClick={saveSignature}>
            <Save className="h-3.5 w-3.5" />
            {signatureSaving ? 'Saving...' : 'Save signature'}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">Email Templates</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Stored subjects and message bodies for manual sends and email categories.
          </p>
        </div>
        {form.id && (
          <Button type="button" variant="outline" size="sm" onClick={() => setForm(EMPTY_FORM)}>
            <X className="h-3.5 w-3.5" />
            Cancel edit
          </Button>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-3 rounded-md border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email-template-name">Name</Label>
              <Input
                id="email-template-name"
                value={form.name}
                onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
                placeholder="Draft review note"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-template-category">Category</Label>
              <select
                id="email-template-category"
                value={form.category}
                onChange={event => setForm(prev => ({ ...prev, category: event.target.value as EmailCategory }))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {EMAIL_CATEGORIES.map(category => (
                  <option key={category} value={category}>
                    {EMAIL_CATEGORY_META[category].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-template-subject">Subject</Label>
            <Input
              id="email-template-subject"
              value={form.subject}
              onChange={event => setForm(prev => ({ ...prev, subject: event.target.value }))}
              placeholder="Your estate plan documents"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="email-template-body">Body</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                aria-pressed={showPreview}
                onClick={() => setShowPreview(prev => !prev)}
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? 'Hide preview' : 'Preview'}
              </Button>
            </div>
            <RichTextEmailEditor
              id="email-template-body"
              ariaLabel="Email template body"
              valueHtml={form.body}
              onChange={html => setForm(prev => ({ ...prev, body: html }))}
              placeholder="Hi {{first_name}},"
            />
          </div>

          {showPreview && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {form.subject.trim()
                  ? <PlaceholderText text={form.subject} />
                  : <span className="text-muted-foreground">No subject yet</span>}
              </p>
              {emailHtmlIsEmpty(form.body) ? (
                <div className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">No body yet</div>
              ) : (
                <div
                  className="mt-2 border-t border-border pt-2 text-sm leading-relaxed text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-accent [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(form.body) }}
                />
              )}
              <p className="mt-2 text-[10px] text-muted-foreground">
                Formatting is preserved — <span className="font-mono">{'{{placeholders}}'}</span> are filled in when the email is sent.
                {' '}Intake invitations support <span className="font-mono">{'{{first_name}}'}</span>,{' '}
                <span className="font-mono">{'{{client_name}}'}</span>, and{' '}
                <span className="font-mono">{'{{intake_link}}'}</span>.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={checked => setForm(prev => ({ ...prev, isActive: checked === true }))}
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isDefault}
                onCheckedChange={checked => setForm(prev => ({ ...prev, isDefault: checked === true }))}
              />
              Default for category
            </label>
            <Button type="button" size="sm" className="ml-auto" disabled={saving} onClick={saveTemplate}>
              {form.id ? <Save className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {saving ? 'Saving...' : form.id ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No templates yet.</div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              {EMAIL_CATEGORIES.map(category => {
                const group = groupedTemplates.get(category) ?? []
                if (group.length === 0) return null
                return (
                  <div key={category} className="border-b border-border last:border-b-0">
                    <div className="bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {EMAIL_CATEGORY_META[category].label}
                    </div>
                    {group.map((template, index) => (
                      <div
                        key={template.id}
                        className={cn('flex items-start gap-3 px-3 py-3', index > 0 && 'border-t border-border')}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
                            {template.isDefault && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-800">
                                Default
                              </span>
                            )}
                            {!template.isActive && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                Inactive
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{template.subject}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground/80">
                            Updated {formatTemplateDate(template.updatedAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" onClick={() => editTemplate(template)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete template ${template.name}`}
                            onClick={() => setPendingDelete(template)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete email template?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${pendingDelete?.name ?? ''}" will be permanently removed. Sends that rely on this template will fall back to the category default.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) void deleteTemplate(pendingDelete)
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
