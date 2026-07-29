'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Layers, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export interface TaskTemplate {
  id: string
  name: string
  description: string | null
  items: Array<{ text: string; offset_days?: number }>
  created_at: string
}

interface DraftItem {
  text: string
  offsetDays: string
}

interface TaskTemplateSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: TaskTemplate[]
  onTemplatesChange: (templates: TaskTemplate[]) => void
}

const EMPTY_ITEM: DraftItem = { text: '', offsetDays: '' }

/**
 * Where task templates are built and retired. Applying one happens from a
 * record's Tasks tab (or `/` in quick capture) — a template is a list of tasks
 * with no record of its own until it lands on a matter or lead.
 */
export function TaskTemplateSheet({
  open,
  onOpenChange,
  templates,
  onTemplatesChange,
}: TaskTemplateSheetProps) {
  const token = useAccessToken()
  const [building, setBuilding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)

  const headers = useMemo(
    (): HeadersInit => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    }),
    [token],
  )

  const reset = useCallback(() => {
    setName('')
    setDescription('')
    setItems([{ ...EMPTY_ITEM }])
    setBuilding(false)
  }, [])

  const filledItems = items.filter(item => item.text.trim())
  const canSave = name.trim().length > 0 && filledItems.length > 0 && !saving

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems(current => current.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const save = useCallback(async () => {
    if (!canSave) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/task-templates', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          items: filledItems.map(item => ({
            text: item.text.trim(),
            offset_days: Number(item.offsetDays) || 0,
          })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? 'Could not save that template')
        return
      }
      onTemplatesChange([...templates, json.template as TaskTemplate].sort((a, b) => a.name.localeCompare(b.name)))
      toast.success(`Saved “${name.trim()}”`)
      reset()
    } finally {
      setSaving(false)
    }
  }, [canSave, headers, name, description, filledItems, templates, onTemplatesChange, reset])

  const archive = useCallback(
    async (template: TaskTemplate) => {
      const res = await fetch(`/api/admin/task-templates/${template.id}`, { method: 'DELETE', headers })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Could not remove that template')
        return
      }
      onTemplatesChange(templates.filter(t => t.id !== template.id))
      toast.success(`Removed “${template.name}”`)
    },
    [headers, templates, onTemplatesChange],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Task templates</SheetTitle>
          <SheetDescription>
            A named list of tasks you add to a matter or lead in one go. Apply one from a record’s
            Tasks tab, or type <strong>/</strong> in quick capture.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 pb-4">
          {templates.length === 0 && !building && (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <Layers className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">No templates yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Build one for the steps you repeat on every matter.
              </p>
            </div>
          )}

          {templates.map(template => (
            <div key={template.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void archive(template)}
                  aria-label={`Remove ${template.name}`}
                  title="Remove template"
                  className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {template.items.map((item, index) => (
                  <li key={index} className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                    <span aria-hidden>·</span>
                    <span className="min-w-0 flex-1">{item.text}</span>
                    {item.offset_days ? (
                      <span className="shrink-0 tabular-nums">+{item.offset_days}d</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {building ? (
            <div className="space-y-3 rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">New template</p>
                <button
                  type="button"
                  onClick={reset}
                  aria-label="Cancel"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <div className="space-y-1">
                <label htmlFor="template-name" className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <Input
                  id="template-name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="New matter kickoff"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="template-description" className="text-xs font-medium text-muted-foreground">
                  Description <span className="font-normal">(optional)</span>
                </label>
                <Input
                  id="template-description"
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  placeholder="What this covers"
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Tasks
                  <span className="ml-1 font-normal">
                    — days are business days from when the template is applied
                  </span>
                </p>
                {items.map((item, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <Input
                      value={item.text}
                      onChange={event => updateItem(index, { text: event.target.value })}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && item.text.trim() && index === items.length - 1) {
                          event.preventDefault()
                          setItems(current => [...current, { ...EMPTY_ITEM }])
                        }
                      }}
                      placeholder={index === 0 ? 'Open the file' : 'Next task'}
                      aria-label={`Task ${index + 1}`}
                      className="h-8 min-w-0 flex-1 text-sm"
                    />
                    <Input
                      value={item.offsetDays}
                      onChange={event =>
                        updateItem(index, { offsetDays: event.target.value.replace(/[^0-9]/g, '') })
                      }
                      placeholder="+0d"
                      aria-label={`Task ${index + 1} due in days`}
                      inputMode="numeric"
                      className="h-8 w-14 shrink-0 text-center text-sm tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => setItems(current =>
                        current.length === 1 ? [{ ...EMPTY_ITEM }] : current.filter((_, i) => i !== index),
                      )}
                      aria-label={`Remove task ${index + 1}`}
                      className={cn(
                        'shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        items.length === 1 && !item.text && 'invisible',
                      )}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setItems(current => [...current, { ...EMPTY_ITEM }])}
                >
                  <Plus className="size-3.5" />
                  Add task
                </Button>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
                  Cancel
                </Button>
                <Button type="button" size="sm" className="h-7 text-xs" disabled={!canSave} onClick={() => void save()}>
                  {saving ? 'Saving…' : `Save template${filledItems.length ? ` · ${filledItems.length}` : ''}`}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setBuilding(true)}
            >
              <Plus className="size-4" />
              New template
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
