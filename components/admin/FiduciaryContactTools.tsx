'use client'

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileSpreadsheet, FileText, Loader as Loader2, Plus, Sparkles, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PRONOUN_OPTIONS } from '@/lib/sharedFields/options'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface FiduciaryContactInput {
  name: string
  relationship: string
  address: string
  email: string
  phone: string
  suffix: string
  preferred_name: string
  preferred_pronoun: string
}

const EMPTY_CONTACT: FiduciaryContactInput = {
  name: '',
  relationship: '',
  address: '',
  email: '',
  phone: '',
  suffix: '',
  preferred_name: '',
  preferred_pronoun: '',
}

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024

interface FiduciaryContactToolsProps {
  onSubmit: (contacts: FiduciaryContactInput[]) => Promise<void>
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.docx') || name.endsWith('.xlsx') || name.endsWith('.csv') || name.endsWith('.txt')
}

export function FiduciaryContactTools({ onSubmit }: FiduciaryContactToolsProps) {
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<FiduciaryContactInput>(EMPTY_CONTACT)

  function update<K extends keyof FiduciaryContactInput>(key: K, value: string) {
    setDraft(prev => ({ ...prev, [key]: value }))
  }

  function reset() {
    setDraft(EMPTY_CONTACT)
    setOpen(false)
  }

  async function saveContacts(contacts: FiduciaryContactInput[], successMessage: string): Promise<boolean> {
    setSaving(true)
    try {
      await onSubmit(contacts)
      toast.success(successMessage)
      reset()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save contacts')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleManualSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.name.trim()) {
      toast.error('Name is required')
      return
    }
    await saveContacts([{ ...draft }], 'Contact added')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add Contact
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => setImportOpen(true)}
          disabled={saving}
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
      </div>

      {open && (
        <form onSubmit={handleManualSubmit} className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fiduciary-name" className="text-xs">Name</Label>
              <Input
                id="fiduciary-name"
                value={draft.name}
                onChange={event => update('name', event.target.value)}
                className="h-8 text-[13px]"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fiduciary-relationship" className="text-xs">Relationship</Label>
              <Input
                id="fiduciary-relationship"
                value={draft.relationship}
                onChange={event => update('relationship', event.target.value)}
                className="h-8 text-[13px]"
                placeholder="Sister, trustee, friend"
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              value={draft.suffix}
              onChange={event => update('suffix', event.target.value)}
              className="h-8 text-[13px]"
              placeholder="Suffix"
            />
            <Input
              value={draft.preferred_name}
              onChange={event => update('preferred_name', event.target.value)}
              className="h-8 text-[13px]"
              placeholder="Preferred name"
            />
            <Select value={draft.preferred_pronoun || undefined} onValueChange={value => update('preferred_pronoun', value)}>
              <SelectTrigger className="h-8 text-[13px]">
                <SelectValue placeholder="Pronouns" />
              </SelectTrigger>
              <SelectContent>
                {PRONOUN_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="email"
              value={draft.email}
              onChange={event => update('email', event.target.value)}
              className="h-8 text-[13px]"
              placeholder="Email"
            />
            <Input
              type="tel"
              value={draft.phone}
              onChange={event => update('phone', event.target.value)}
              className="h-8 text-[13px]"
              placeholder="Phone"
            />
          </div>
          <Input
            value={draft.address}
            onChange={event => update('address', event.target.value)}
            className="h-8 text-[13px]"
            placeholder="Address"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={reset} disabled={saving}>
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-7 text-[11px]" disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
              Save
            </Button>
          </div>
        </form>
      )}

      <FiduciaryContactImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onAttach={async (contacts) => {
          const saved = await saveContacts(contacts, `${contacts.length} contact${contacts.length === 1 ? '' : 's'} attached`)
          if (saved) setImportOpen(false)
        }}
      />
    </div>
  )
}

export function FiduciaryContactImportDialog({
  open,
  onOpenChange,
  onAttach,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAttach: (contacts: FiduciaryContactInput[]) => Promise<void>
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [mode, setMode] = useState<'text' | 'file'>('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [contacts, setContacts] = useState<FiduciaryContactInput[]>([])

  function resetFile() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function resetAll() {
    setText('')
    resetFile()
    setContacts([])
    setMode('text')
  }

  function acceptFile(selected: File) {
    if (!isSupportedFile(selected)) {
      toast.error('Use a Word .docx, Excel .xlsx, CSV, or text file')
      resetFile()
      return
    }
    if (selected.size > MAX_IMPORT_FILE_BYTES) {
      toast.error('Document is too large (10 MB max)')
      resetFile()
      return
    }
    setFile(selected)
    setContacts([])
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null
    if (selected) acceptFile(selected)
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragOver(false)
    const selected = event.dataTransfer.files[0]
    if (selected) acceptFile(selected)
  }

  async function parseText() {
    const trimmed = text.trim()
    if (trimmed.length < 10) {
      toast.error('Paste at least 10 characters')
      return
    }
    setParsing(true)
    try {
      const response = await fetch('/api/admin/contacts/import/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? `Parse failed (${response.status})`)
      setContacts((json.contacts ?? []) as FiduciaryContactInput[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not parse contacts')
    } finally {
      setParsing(false)
    }
  }

  async function parseFile() {
    if (!file) {
      toast.error('Choose a document first')
      return
    }
    const formData = new FormData()
    formData.append('file', file)
    setParsing(true)
    try {
      const response = await fetch('/api/admin/contacts/import/parse', {
        method: 'POST',
        body: formData,
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error ?? `Import failed (${response.status})`)
      setContacts((json.contacts ?? []) as FiduciaryContactInput[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import contacts')
    } finally {
      setParsing(false)
    }
  }

  async function attachParsedContacts() {
    if (contacts.length === 0) return
    setAttaching(true)
    try {
      await onAttach(contacts)
      resetAll()
    } finally {
      setAttaching(false)
    }
  }

  const parseDisabled = parsing || (mode === 'text' ? text.trim().length < 10 : !file)

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (parsing || attaching) return
      if (!next) resetAll()
      onOpenChange(next)
    }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            Import Contacts
          </DialogTitle>
          <DialogDescription>
            Paste contact notes or upload a Word or Excel document. Review the extracted contacts before attaching them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-1">
            <Button
              type="button"
              variant={mode === 'text' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => { setMode('text'); setContacts([]) }}
              disabled={parsing || attaching}
              className="gap-2"
            >
              <FileText className="h-3.5 w-3.5" />
              Paste Text
            </Button>
            <Button
              type="button"
              variant={mode === 'file' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => { setMode('file'); setContacts([]) }}
              disabled={parsing || attaching}
              className="gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Document
            </Button>
          </div>

          {mode === 'text' ? (
            <div className="space-y-2">
              <Textarea
                value={text}
                onChange={event => { setText(event.target.value); setContacts([]) }}
                disabled={parsing || attaching}
                rows={10}
                placeholder="Paste names, emails, phone numbers, relationship notes, or a contact list..."
                className="tabular-nums text-[12px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {text.length.toLocaleString()} characters
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={event => { event.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                disabled={parsing || attaching}
                className={cn(
                  'flex min-h-36 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-background px-6 py-8 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60',
                  dragOver && 'border-accent bg-muted/60',
                )}
              >
                <Upload className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">Choose or drop a Word or Excel document</span>
                <span className="text-xs text-muted-foreground">Supports .docx, .xlsx, .csv, and .txt</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,.xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                className="hidden"
                onChange={handleFileChange}
              />
              {file && (
                <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2">
                  {file.name.toLowerCase().endsWith('.xlsx')
                    ? <FileSpreadsheet className="h-4 w-4 text-accent" />
                    : <FileText className="h-4 w-4 text-accent" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => { resetFile(); setContacts([]) }} disabled={parsing || attaching} aria-label="Remove selected document">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {contacts.length > 0 && (
            <div className="rounded-md border border-border">
              <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
                {contacts.length} contact{contacts.length === 1 ? '' : 's'} ready to attach
              </div>
              <div className="max-h-56 divide-y divide-border overflow-y-auto">
                {contacts.map((contact, index) => (
                  <div key={`${contact.name}-${contact.email}-${index}`} className="px-3 py-2 text-sm">
                    <div className="font-medium text-foreground">{contact.name || 'Unnamed contact'}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[contact.relationship, contact.email, contact.phone, contact.address].filter(Boolean).join(' · ') || 'No details'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={parsing || attaching}>
            Cancel
          </Button>
          {contacts.length === 0 ? (
            <Button type="button" onClick={mode === 'text' ? parseText : parseFile} disabled={parseDisabled} className="gap-2">
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {mode === 'text' ? 'Parse Text' : 'Import Document'}
            </Button>
          ) : (
            <Button type="button" onClick={attachParsedContacts} disabled={attaching} className="gap-2">
              {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Attach Contacts
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
