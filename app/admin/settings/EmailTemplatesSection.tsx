'use client'

import { revealOnNarrowScreen } from '@/lib/revealOnNarrowScreen'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, PenLine, Plus, Save, Trash2 } from 'lucide-react'
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
import {
  emailTemplateToken,
  emailTemplateVariables,
} from '@/lib/email/templateVariables'

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

function VariableInsertSelect({
  ariaLabel,
  options,
  onInsert,
}: {
  ariaLabel: string
  options: Array<{ key: string; label: string; hint: string }>
  onInsert: (key: string) => void
}) {
  if (options.length === 0) return null
  return (
    <select
      aria-label={ariaLabel}
      defaultValue=""
      onChange={event => {
        if (event.target.value) onInsert(event.target.value)
        event.target.value = ''
      }}
      className="h-6 rounded border border-input bg-background px-1 text-micro text-muted-foreground"
    >
      <option value="">Insert variable…</option>
      {options.map(option => (
        <option key={option.key} value={option.key} title={option.hint}>
          {option.label}
        </option>
      ))}
    </select>
  )
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
            className="mx-0.5 inline-block rounded bg-primary/10 px-1 py-px font-mono text-[0.85em] font-medium text-primary"
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
  const [subjectSelection, setSubjectSelection] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<EmailTemplateRow | null>(null)
  const [signatureHtml, setSignatureHtml] = useState('')
  const [signatureDefault, setSignatureDefault] = useState(true)
  const [signatureSaving, setSignatureSaving] = useState(false)
  const [showSignaturePreview, setShowSignaturePreview] = useState(false)
  // The right-hand pane edits either the firm signature or one template (new or existing).
  const [pane, setPane] = useState<'template' | 'signature'>('template')
  const editorRef = useRef<HTMLDivElement>(null)

  /** On a phone the editor sits below the list; bring it into view after a pick. */
  function revealEditor() {
    revealOnNarrowScreen(() => editorRef.current)
  }

  function startNewTemplate() {
    setForm(EMPTY_FORM)
    setShowPreview(false)
    setPane('template')
    revealEditor()
  }

  function openSignature() {
    setPane('signature')
    revealEditor()
  }

  // Offered tags follow the category: a variable the send path never resolves
  // would ship a literal {{…}} to a client's inbox.
  const variableOptions = useMemo(
    () => emailTemplateVariables(form.category),
    [form.category],
  )

  /** Insert at the caret, or append when the field has not been focused yet. */
  function insertIntoSubject(token: string) {
    setForm(prev => {
      const at = subjectSelection ?? prev.subject.length
      const next = `${prev.subject.slice(0, at)}${token}${prev.subject.slice(at)}`
      setSubjectSelection(at + token.length)
      return { ...prev, subject: next }
    })
  }

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
    setPane('template')
    setShowPreview(false)
    revealEditor()
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

  const editingTemplate = form.id ? templates.find(template => template.id === form.id) : null
  const signatureSet = !emailHtmlIsEmpty(signatureHtml)

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* Left: the signature, then every template grouped by category. Picking a row opens it on the right. */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <p className="text-sm font-medium">
            Templates{' '}
            {!loading && <span className="font-normal text-muted-foreground">· {templates.length}</span>}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={startNewTemplate}>
            <Plus className="h-3.5 w-3.5" /> New template
          </Button>
        </div>

        <button
          type="button"
          onClick={openSignature}
          aria-current={pane === 'signature' ? 'true' : undefined}
          className={cn(
            'flex w-full items-start gap-2 border-b border-border px-3 py-2.5 text-left hover:bg-accent',
            pane === 'signature' && 'bg-selected',
          )}
        >
          <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Firm signature</span>
            <span className="block text-xs text-muted-foreground">
              {signatureSet
                ? signatureDefault ? 'Added to manual emails by default' : 'Offered on manual emails, off by default'
                : 'Not set'}
            </span>
          </span>
        </button>

        {loading ? (
          <div className="p-3 text-sm text-muted-foreground">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">No templates yet.</div>
        ) : (
          EMAIL_CATEGORIES.map(category => {
            const group = groupedTemplates.get(category) ?? []
            if (group.length === 0) return null
            return (
              <div key={category} className="border-b border-border last:border-b-0">
                <div className="bg-muted px-3 py-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  {EMAIL_CATEGORY_META[category].label}
                </div>
                {group.map((template, index) => {
                  const selected = pane === 'template' && form.id === template.id
                  return (
                    <div
                      key={template.id}
                      className={cn(
                        'group flex items-start gap-1 hover:bg-accent',
                        index > 0 && 'border-t border-border',
                        selected && 'bg-selected',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => editTemplate(template)}
                        aria-current={selected ? 'true' : undefined}
                        className="min-w-0 flex-1 px-3 py-2.5 text-left"
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">{template.name}</span>
                          {template.isDefault && (
                            <span className="rounded bg-blue-bg px-1.5 py-0.5 text-micro font-medium text-blue">Default</span>
                          )}
                          {!template.isActive && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground">Inactive</span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={template.subject}>
                          {template.subject}
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="mr-1.5 mt-2"
                        aria-label={`Delete template ${template.name}`}
                        onClick={() => setPendingDelete(template)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {/* Right: the editor for whatever is picked on the left. */}
      <div ref={editorRef} className="min-w-0 scroll-mt-4">
        {pane === 'signature' ? (
          <div className="space-y-3 rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Firm signature</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Offered on manual emails. Automated notices are unchanged.
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
                className="rounded-md border border-border bg-muted p-3 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline"
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
        ) : (
          <div className="space-y-3 rounded-md border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">
                  {form.id ? `Edit · ${editingTemplate?.name ?? form.name}` : 'New template'}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.id
                    ? `Last updated ${formatTemplateDate(editingTemplate?.updatedAt ?? null)}`
                    : 'A stored subject and message for manual sends or an email category.'}
                </p>
              </div>
              {form.id && (
                <Button type="button" variant="ghost" size="sm" onClick={startNewTemplate}>
                  Cancel
                </Button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-template-name">Name</Label>
                <Input
                  id="email-template-name"
                  value={form.name}
                  onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. Draft review note"
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
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="email-template-subject">Subject</Label>
                <VariableInsertSelect
                  ariaLabel="Insert subject variable"
                  options={variableOptions}
                  onInsert={key => insertIntoSubject(emailTemplateToken(key))}
                />
              </div>
              <Input
                id="email-template-subject"
                value={form.subject}
                onChange={event => setForm(prev => ({ ...prev, subject: event.target.value }))}
                onSelect={event => setSubjectSelection(event.currentTarget.selectionStart)}
                onBlur={event => setSubjectSelection(event.currentTarget.selectionStart)}
                placeholder="e.g. Your estate plan documents"
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
                variableOptions={variableOptions}
              />
              <p className="text-micro text-muted-foreground">
                Variables are filled in when the email is sent. Insert variable lists the ones this category supports.
              </p>
            </div>

            {showPreview && (
              <div className="rounded-md border border-border bg-muted p-3">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {form.subject.trim()
                    ? <PlaceholderText text={form.subject} />
                    : <span className="text-muted-foreground">No subject yet</span>}
                </p>
                {emailHtmlIsEmpty(form.body) ? (
                  <div className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">No body yet</div>
                ) : (
                  <div
                    className="mt-2 border-t border-border pt-2 text-sm leading-relaxed text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline"
                    dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(form.body) }}
                  />
                )}
                <p className="mt-2 text-micro text-muted-foreground">
                  Formatting is preserved — <span className="font-mono">{'{{placeholders}}'}</span> are filled in when the email is sent.
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
                {saving ? 'Saving...' : form.id ? 'Save changes' : 'Create template'}
              </Button>
            </div>
          </div>
        )}
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
