'use client'

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileSpreadsheet, FileText, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const MAX_BYTES = 10 * 1024 * 1024

const DOC_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
} as const

interface ImportAssetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  intakeId: string
  accessToken: string | null
  onImported: (count: number) => void
}

function isSupportedAssetImportFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.docx') ||
    name.endsWith('.xlsx') ||
    name.endsWith('.csv') ||
    file.type === DOC_TYPES.pdf ||
    file.type === DOC_TYPES.docx ||
    file.type === DOC_TYPES.xlsx ||
    file.type === DOC_TYPES.csv
  )
}

function fileKindLabel(file: File): string {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.csv')) return 'Spreadsheet import'
  return 'Document import (AI)'
}

export function ImportAssetsDialog({
  open,
  onOpenChange,
  intakeId,
  accessToken,
  onImported,
}: ImportAssetsDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function acceptFile(selected: File) {
    if (!isSupportedAssetImportFile(selected)) {
      toast.error('Supported formats: PDF, Word .docx, Excel .xlsx, or .csv')
      reset()
      return
    }
    if (selected.size > MAX_BYTES) {
      toast.error('File is too large (10 MB max)')
      reset()
      return
    }
    setFile(selected)
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) acceptFile(selected)
  }

  function handleDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) acceptFile(dropped)
  }

  async function handleSubmit() {
    if (!file) {
      toast.error('Choose a file to import')
      return
    }
    if (!accessToken) {
      toast.error('Not signed in')
      return
    }
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/admin/assets/${intakeId}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error ?? 'Import failed')
      }
      const inserted = Number(data.inserted) || 0
      toast.success(inserted > 0 ? `Imported ${inserted} asset${inserted === 1 ? '' : 's'}` : 'No assets found in file')
      onImported(inserted)
      reset()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setSubmitting(false)
    }
  }

  const isSpreadsheet = file ? file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.csv') : false

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import assets</DialogTitle>
          <DialogDescription>
            Upload an Excel or CSV spreadsheet, or a PDF/Word document. Spreadsheets import directly;
            documents are parsed with AI. Exported asset reports (.xlsx) can be re-imported as-is.
          </DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onDragOver={e => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
            dragOver ? 'border-brand-navy bg-brand-navy/5' : 'border-border hover:border-border-strong',
          )}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-medium">Drop file here or click to browse</span>
          <span className="text-xs text-muted-foreground">.xlsx, .csv, PDF, or .docx — up to 10 MB</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,.pdf,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleFileChange}
          />
        </button>

        {file && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {isSpreadsheet ? (
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{fileKindLabel(file)}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={reset}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || !file}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import assets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
