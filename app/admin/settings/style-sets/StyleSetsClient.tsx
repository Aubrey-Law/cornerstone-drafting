'use client'

import { useRef, useState } from 'react'
import { Check, Loader2, Plus, Star, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import {
  STYLE_SET_FIELD_GROUPS,
  countOverrides,
  describeStyleSet,
  readField,
  writeField,
  type StyleSetField,
} from '@/lib/styleSets/editorFields'
import { PRESERVE, PRESERVE_ALL_SETTINGS, type StyleSetSettings } from '@/lib/styleSets/schema'

/**
 * The style set editor.
 *
 * One idea governs the layout: **every control's default is "preserve"**, and
 * it is always the first option, spelled out rather than implied by an empty
 * box. A firm's templates already carry formatting somebody chose, and the
 * common case is overriding two or three things about them — so the form is
 * built to make "leave this alone" the easy, obvious answer and an override the
 * deliberate one.
 *
 * Uploading a template fills the form in rather than saving anything. What
 * extraction reads is sometimes a compromise (a document with three fonts
 * cannot be described by a style set that has one), so the caveats are shown
 * beside the values and saving stays a separate decision.
 */

export interface StyleSetSummary {
  id: string
  name: string
  description: string | null
  settings: StyleSetSettings
  is_default: boolean
  source_file_name: string | null
  updated_at: string
}

interface Draft {
  id: string | null
  name: string
  description: string
  settings: StyleSetSettings
  isDefault: boolean
  sourceFileName: string | null
}

function draftFrom(styleSet: StyleSetSummary): Draft {
  return {
    id: styleSet.id,
    name: styleSet.name,
    description: styleSet.description ?? '',
    settings: styleSet.settings,
    isDefault: styleSet.is_default,
    sourceFileName: styleSet.source_file_name,
  }
}

function emptyDraft(): Draft {
  return {
    id: null,
    name: '',
    description: '',
    settings: PRESERVE_ALL_SETTINGS,
    isDefault: false,
    sourceFileName: null,
  }
}

export function StyleSetsClient({ initialStyleSets }: { initialStyleSets: StyleSetSummary[] }) {
  const [styleSets, setStyleSets] = useState(initialStyleSets)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StyleSetSummary | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function refresh() {
    const response = await fetch('/api/admin/style-sets')
    if (!response.ok) return
    const body = (await response.json()) as { styleSets: StyleSetSummary[] }
    setStyleSets(body.styleSets)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      settings: draft.settings,
      isDefault: draft.isDefault,
      sourceFileName: draft.sourceFileName,
    }
    const response = await fetch(
      draft.id ? `/api/admin/style-sets/${draft.id}` : '/api/admin/style-sets',
      {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )

    setBusy(false)
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? 'Could not save the style set')
      return
    }
    setDraft(null)
    setNotes([])
    await refresh()
  }

  async function makeDefault(styleSet: StyleSetSummary) {
    setBusy(true)
    await fetch(`/api/admin/style-sets/${styleSet.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    })
    setBusy(false)
    await refresh()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setBusy(true)
    await fetch(`/api/admin/style-sets/${pendingDelete.id}`, { method: 'DELETE' })
    setPendingDelete(null)
    setBusy(false)
    await refresh()
  }

  async function extractFrom(file: File) {
    setBusy(true)
    setError(null)
    setNotes([])

    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/admin/style-sets/extract', { method: 'POST', body: form })
    setBusy(false)

    const body = (await response.json().catch(() => ({}))) as {
      settings?: StyleSetSettings
      notes?: string[]
      error?: string
    }
    if (!response.ok || !body.settings) {
      setError(body.error ?? 'Could not read that document')
      return
    }

    setNotes(body.notes ?? [])
    setDraft(current => ({
      ...(current ?? emptyDraft()),
      // A name the user already typed is theirs; only fill a blank one.
      name: current?.name?.trim() ? current.name : file.name.replace(/\.docx$/i, ''),
      settings: body.settings!,
      sourceFileName: file.name,
    }))
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Style sets</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            How generated documents are formatted. Anything left as{' '}
            <span className="font-medium">the template&rsquo;s own</span> keeps whatever formatting
            the Word template already carried, so a style set only changes what it names.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0]
              // Reset so re-picking the same file fires change again.
              event.target.value = ''
              if (file) void extractFrom(file)
            }}
          />
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" aria-hidden />
            Read from a template
          </Button>
          <Button disabled={busy} onClick={() => { setDraft(emptyDraft()); setNotes([]) }}>
            <Plus className="size-4" aria-hidden />
            New style set
          </Button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {draft ? (
        <Editor
          draft={draft}
          notes={notes}
          busy={busy}
          onChange={setDraft}
          onCancel={() => { setDraft(null); setNotes([]); setError(null) }}
          onSave={save}
          onUpload={() => fileInput.current?.click()}
        />
      ) : (
        <StyleSetList
          styleSets={styleSets}
          busy={busy}
          onEdit={styleSet => { setDraft(draftFrom(styleSet)); setNotes([]) }}
          onMakeDefault={makeDefault}
          onDelete={setPendingDelete}
        />
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{pendingDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Documents already generated with it keep their formatting and their record of which
              style set produced them. Anything set to use it falls back to the firm default.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StyleSetList({
  styleSets,
  busy,
  onEdit,
  onMakeDefault,
  onDelete,
}: {
  styleSets: StyleSetSummary[]
  busy: boolean
  onEdit: (styleSet: StyleSetSummary) => void
  onMakeDefault: (styleSet: StyleSetSummary) => void
  onDelete: (styleSet: StyleSetSummary) => void
}) {
  if (styleSets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <p className="text-sm font-medium">No style sets yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Documents are generated in Garamond, with everything else left as the template has it.
          Read a template you already like the look of, or start one from scratch.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {styleSets.map(styleSet => {
        const summary = describeStyleSet(styleSet.settings)
        return (
          <li key={styleSet.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => onEdit(styleSet)}
              className="min-w-0 flex-1 text-start"
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{styleSet.name}</span>
                {styleSet.is_default && (
                  <Badge variant="secondary" className="shrink-0">
                    Firm default
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {styleSet.description ||
                  summary ||
                  'Changes nothing — every setting is left as the template has it.'}
              </span>
            </button>

            {!styleSet.is_default && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onMakeDefault(styleSet)}
              >
                <Star className="size-4" aria-hidden />
                Make default
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onDelete(styleSet)}
              aria-label={`Delete ${styleSet.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

function Editor({
  draft,
  notes,
  busy,
  onChange,
  onCancel,
  onSave,
  onUpload,
}: {
  draft: Draft
  notes: string[]
  busy: boolean
  onChange: (draft: Draft) => void
  onCancel: () => void
  onSave: () => void
  onUpload: () => void
}) {
  const overrides = countOverrides(draft.settings)

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-lg border border-border p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="style-set-name">Name</Label>
            <Input
              id="style-set-name"
              value={draft.name}
              placeholder="House style"
              onChange={event => onChange({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="style-set-description">Description</Label>
            <Input
              id="style-set-description"
              value={draft.description}
              placeholder="What this is for"
              onChange={event => onChange({ ...draft, description: event.target.value })}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-border"
            checked={draft.isDefault}
            onChange={event => onChange({ ...draft, isDefault: event.target.checked })}
          />
          <span>
            Use this for every generated document
            <span className="block text-xs text-muted-foreground">
              Replaces the current firm default. Only one style set can hold it.
            </span>
          </span>
        </label>

        {draft.sourceFileName && (
          <p className="text-xs text-muted-foreground">
            Read from <span className="font-medium">{draft.sourceFileName}</span>.{' '}
            <button type="button" onClick={onUpload} className="underline hover:no-underline">
              Read a different template
            </button>
          </p>
        )}
      </section>

      {notes.length > 0 && (
        <section className="space-y-2 rounded-lg border border-amber-border bg-amber-bg p-4">
          <h2 className="text-sm font-medium">What the template could not say</h2>
          {/*
            Shown rather than swallowed: a style set describes one font, one
            title size and one page. A template that disagrees with itself has
            to lose something, and the person choosing should see what.
          */}
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
            {notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-sm text-muted-foreground">
        {overrides === 0
          ? 'Nothing is overridden yet, so this style set would leave every document exactly as its template is.'
          : `${overrides} setting${overrides === 1 ? '' : 's'} overridden. Everything else is left as the template has it.`}
      </p>

      {/*
        A fieldset rather than a section: "Font", "Size" and "Alignment" each
        appear five times on this page, and without a grouping element their
        accessible names are identical. The legend is what tells a screen-reader
        user which font they are editing.
      */}
      {STYLE_SET_FIELD_GROUPS.map(group => (
        <fieldset key={group.key} className="min-w-0 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">{group.title}</legend>
          <p className="mt-0.5 text-xs text-muted-foreground">{group.description}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {group.fields.map(field => (
              <FieldControl
                key={field.path}
                field={field}
                value={readField(draft.settings, field.path)}
                onChange={value =>
                  onChange({ ...draft, settings: writeField(draft.settings, field.path, value) })
                }
              />
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center gap-2">
        <Button onClick={onSave} disabled={busy || !draft.name.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          {draft.id ? 'Save changes' : 'Create style set'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

const PRESERVE_LABEL = 'The template’s own'

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: StyleSetField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `style-set-${field.path.replaceAll('.', '-')}`
  const isPreserved = value === PRESERVE

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={cn(isPreserved && 'text-muted-foreground')}>
        {field.label}
      </Label>

      {field.kind.type === 'text' && (
        <Input
          id={id}
          value={isPreserved ? '' : String(value ?? '')}
          placeholder={PRESERVE_LABEL}
          onChange={event => onChange(event.target.value.trim() === '' ? PRESERVE : event.target.value)}
        />
      )}

      {field.kind.type === 'number' && (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={field.kind.min}
            max={field.kind.max}
            step={field.kind.step}
            value={isPreserved ? '' : String(value ?? '')}
            placeholder={PRESERVE_LABEL}
            onChange={event => {
              const raw = event.target.value
              if (raw.trim() === '') return onChange(PRESERVE)
              const parsed = Number(raw)
              onChange(Number.isFinite(parsed) ? parsed : PRESERVE)
            }}
          />
          <span className="shrink-0 text-xs text-muted-foreground">{field.kind.unit}</span>
        </div>
      )}

      {field.kind.type === 'boolean' && (
        <select
          id={id}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={isPreserved ? PRESERVE : value === true ? 'on' : 'off'}
          onChange={event =>
            onChange(event.target.value === PRESERVE ? PRESERVE : event.target.value === 'on')
          }
        >
          <option value={PRESERVE}>{PRESERVE_LABEL}</option>
          <option value="on">{field.kind.onLabel}</option>
          <option value="off">{field.kind.offLabel}</option>
        </select>
      )}

      {field.kind.type === 'enum' && (
        <select
          id={id}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={isPreserved ? PRESERVE : String(value)}
          onChange={event => onChange(event.target.value)}
        >
          <option value={PRESERVE}>{PRESERVE_LABEL}</option>
          {field.kind.options.map(option => (
            <option key={option} value={option}>
              {field.kind.type === 'enum' ? field.kind.labels[option] : option}
            </option>
          ))}
        </select>
      )}

      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
    </div>
  )
}
