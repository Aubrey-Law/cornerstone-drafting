'use client'

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileText, Loader2, Sparkles, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_DOCX_BYTES = 10 * 1024 * 1024

interface ImportIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId?: string
  accessToken: string | null
  onParsed: (intakeId: string, result: ImportIntakeResult) => void
  parseTextUrl?: string
  parseDocxUrl?: string
  successMessage?: string
}

export interface ImportIntakeResult {
  intakeId: string
  /** Raw lead row echoed by the parse endpoint; no caller reads into it. */
  lead?: Record<string, unknown>
  data?: unknown
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function ImportIntakeDialog({
  open, onOpenChange, leadId, accessToken, onParsed, parseTextUrl, parseDocxUrl, successMessage,
}: ImportIntakeDialogProps) {
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'text' | 'docx'>('text')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function resetDocxFile() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function acceptDocxFile(selected: File) {
    const isDocx = selected.name.toLowerCase().endsWith('.docx') || selected.type === DOCX_MIME_TYPE
    if (!isDocx) {
      toast.error('Only Word .docx documents are supported')
      resetDocxFile()
      return
    }
    if (selected.size > MAX_DOCX_BYTES) {
      toast.error('Word document is too large (10 MB max)')
      resetDocxFile()
      return
    }
    setFile(selected)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    if (selected) acceptDocxFile(selected)
  }

  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setDragOver(false)
    const selected = e.dataTransfer.files[0]
    if (selected) acceptDocxFile(selected)
  }

  function handleParsed(result: ImportIntakeResult) {
    toast.success(successMessage ?? 'Intake draft populated - review and submit')
    setText('')
    resetDocxFile()
    onParsed(result.intakeId, result)
  }

  async function handleTextSubmit() {
    if (!accessToken) { toast.error('Not authenticated'); return }
    const trimmed = text.trim()
    if (trimmed.length < 20) {
      toast.error('Paste a longer block of text (at least 20 characters)')
      return
    }
    setSubmitting(true)
    try {
      const url = parseTextUrl ?? (leadId ? `/api/admin/leads/${leadId}/parse-intake` : null)
      if (!url) throw new Error('Missing lead import target')
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ text: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Parse failed (${res.status})`)
      if (typeof json.intakeId !== 'string') throw new Error('Import succeeded but no intake ID was returned')
      handleParsed(json as ImportIntakeResult)
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : 'Could not parse intake')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDocxSubmit() {
    if (!accessToken) { toast.error('Not authenticated'); return }
    if (!file) { toast.error('Choose a Word document first'); return }

    const fd = new FormData()
    fd.append('file', file)

    setSubmitting(true)
    try {
      const url = parseDocxUrl ?? (leadId ? `/api/admin/leads/${leadId}/parse-intake-docx` : null)
      if (!url) throw new Error('Missing lead import target')
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`)
      if (typeof json.intakeId !== 'string') throw new Error('Import succeeded but no intake ID was returned')
      handleParsed(json as ImportIntakeResult)
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : 'Could not import Word document')
    } finally {
      setSubmitting(false)
    }
  }

  const textDisabled = submitting || text.trim().length < 20 || text.length > 60_000
  const docxDisabled = submitting || !file

  return (
    <Dialog open={open} onOpenChange={v => { if (!submitting) onOpenChange(v) }}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-4 pb-4 pt-5 pr-10 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Import Intake
          </DialogTitle>
          <DialogDescription>
            Paste notes or upload a Word document. Claude will extract the fields
            and pre-fill a draft intake for review before anything is submitted.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-1">
            <Button
              type="button"
              variant={mode === 'text' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('text')}
              disabled={submitting}
              className="gap-2"
            >
              <FileText className="h-3.5 w-3.5" />
              Paste Text
            </Button>
            <Button
              type="button"
              variant={mode === 'docx' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setMode('docx')}
              disabled={submitting}
              className="gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              Word Document
            </Button>
          </div>

          {mode === 'text' ? (
            <div className="space-y-2">
              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                disabled={submitting}
                rows={14}
                placeholder="Paste anything: prior questionnaire answers, an email from the client, a Lawmatics activity dump, or notes from a phone call..."
                className="tabular-nums text-[12px]"
              />
              <p className="text-[11px] text-muted-foreground">
                {text.length.toLocaleString()} characters
                {text.length > 60_000 && ' - over the 60,000 limit'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                disabled={submitting}
                className={cn(
                  'flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-background px-6 py-8 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60',
                  dragOver && 'border-primary bg-muted/60',
                )}
              >
                <Upload className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">
                  Choose or drop a Word intake document
                </span>
                <span className="text-xs text-muted-foreground">
                  DOCX only. The import creates a draft for review.
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={handleFileChange}
              />
              {file && (
                <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={resetDocxFile}
                    disabled={submitting}
                    aria-label="Remove selected document"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t bg-background px-4 py-3 sm:px-6 sm:py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={mode === 'text' ? handleTextSubmit : handleDocxSubmit}
            disabled={mode === 'text' ? textDisabled : docxDisabled}
            className="gap-2"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {mode === 'text' ? 'Parsing...' : 'Importing...'}</>
              : <><Sparkles className="h-4 w-4" /> {mode === 'text' ? 'Parse with AI' : 'Import with AI'}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
