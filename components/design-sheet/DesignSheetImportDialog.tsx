'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { FileText, Loader2, Upload, Users, WandSparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { ResolvedFiduciaryProposal } from '@/lib/designSheet/fiduciaryProposal'
import {
  DOCX_MIME_TYPE,
  MIN_DESIGN_SHEET_IMPORT_TEXT_LENGTH,
  MAX_DESIGN_SHEET_DOCX_BYTES,
  type DesignSheetImportPreviewRow,
  type DesignSheetImportProposal,
  type DesignSheetImportRejection,
} from '@/lib/designSheetImport/shared'
import type { DesignSheet } from '@/types/database'

interface DesignSheetImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  matterId: string
  currentSheet?: DesignSheet | null
  allowUpload?: boolean
  initialPreview?: DesignSheetImportPreviewRow[] | null
  initialProposed?: DesignSheetImportProposal | null
  initialFiduciaries?: ResolvedFiduciaryProposal[] | null
  /** Guards the save with the sheet the workspace last loaded. */
  expectedUpdatedAt?: string | null
  onAccepted?: (patch: DesignSheetImportProposal, fiduciaryCount: number) => void
}

/** Where the proposal comes from. Each ends in the same accept-per-field review. */
type ProposalSource = 'upload' | 'gaps' | 'text'

const SOURCE_OPTIONS: Array<{ value: ProposalSource; label: string; hint: string }> = [
  { value: 'gaps', label: 'Fill what is missing', hint: 'Uses this matter\u2019s intake, contacts, assets and recent meeting notes.' },
  { value: 'text', label: 'Paste notes', hint: 'Paste a meeting note, an email, or a client\u2019s answers.' },
  { value: 'upload', label: 'Word document', hint: 'A completed design sheet as a .docx file.' },
]

type ImportDocxResponse = {
  error?: string
  proposed?: DesignSheetImportProposal
  preview?: DesignSheetImportPreviewRow[]
  rejected?: DesignSheetImportRejection[]
}

type AutofillResponse = ImportDocxResponse & {
  fiduciaries?: ResolvedFiduciaryProposal[]
  blocking_count?: number
}

type ApplyProposalResponse = {
  error?: string
  conflict?: boolean
  id?: string
}

function buildSelectedRows(rows: DesignSheetImportPreviewRow[]) {
  return Object.fromEntries(rows.map(row => [row.field, row.selected])) as Record<string, boolean>
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Values the document offered that the field cannot hold. Shown rather than dropped:
 * the document said something about this field, and silently ignoring it reads as
 * "the import found nothing" — which is how a stray value went unnoticed before.
 */
function RejectedValues({ rejected }: { rejected: DesignSheetImportRejection[] }) {
  if (rejected.length === 0) return null

  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5">
      <p className="text-xs font-medium text-warning">
        {rejected.length === 1 ? 'One value was not applied' : `${rejected.length} values were not applied`}
      </p>
      <ul className="mt-1.5 space-y-1">
        {rejected.map(row => (
          <li key={row.field} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{row.label}</span>
            {': '}
            <span className="italic">&ldquo;{row.value}&rdquo;</span>
            {' is not one of '}
            {row.options.join(', ')}
            {'. Set it in the design sheet if it applies.'}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DesignSheetImportDialog({
  open,
  onOpenChange,
  matterId,
  currentSheet = null,
  allowUpload = true,
  initialPreview = null,
  initialProposed = null,
  initialFiduciaries = null,
  expectedUpdatedAt = null,
  onAccepted,
}: DesignSheetImportDialogProps) {
  const [sourceMode, setSourceMode] = useState<ProposalSource>('gaps')
  const [pastedText, setPastedText] = useState('')
  const [fiduciaryRows, setFiduciaryRows] = useState<ResolvedFiduciaryProposal[]>([])
  const [selectedFiduciaries, setSelectedFiduciaries] = useState<Record<string, boolean>>({})
  const [file, setFile] = useState<File | null>(null)
  const [previewRows, setPreviewRows] = useState<DesignSheetImportPreviewRow[]>([])
  const [proposed, setProposed] = useState<DesignSheetImportProposal>({})
  const [rejected, setRejected] = useState<DesignSheetImportRejection[]>([])
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const hasPreview = previewRows.length > 0 || fiduciaryRows.length > 0
  const selectedCount = useMemo(
    () => previewRows.filter(row => selectedRows[row.field]).length,
    [previewRows, selectedRows],
  )
  const selectedFiduciaryCount = useMemo(
    () => fiduciaryRows.filter(row => selectedFiduciaries[row.id]).length,
    [fiduciaryRows, selectedFiduciaries],
  )

  const clearFileInput = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const resetFile = useCallback(() => {
    setFile(null)
    clearFileInput()
  }, [clearFileInput])

  useEffect(() => {
    if (!open) return

    const rows = initialPreview ?? []
    const people = initialFiduciaries ?? []
    setFile(null)
    setPreviewRows(rows)
    setProposed(initialProposed ?? {})
    setSelectedRows(buildSelectedRows(rows))
    setFiduciaryRows(people)
    setSelectedFiduciaries(Object.fromEntries(people.map(row => [row.id, row.selected])))
    setRejected([])
    setPastedText('')
    setSourceMode(allowUpload ? 'gaps' : 'gaps')
    setSubmitting(false)
    setDragOver(false)
    clearFileInput()
  }, [allowUpload, clearFileInput, initialFiduciaries, initialPreview, initialProposed, open])

  const acceptFile = useCallback((selectedFile: File) => {
    const isDocx =
      selectedFile.name.toLowerCase().endsWith('.docx') ||
      selectedFile.type === DOCX_MIME_TYPE

    if (!isDocx) {
      toast.error('Only Word .docx documents are supported')
      resetFile()
      return
    }

    if (selectedFile.size > MAX_DESIGN_SHEET_DOCX_BYTES) {
      toast.error('Word document is too large (10 MB max)')
      resetFile()
      return
    }

    setFile(selectedFile)
  }, [resetFile])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null
    if (selectedFile) acceptFile(selectedFile)
  }, [acceptFile])

  const handleDrop = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragOver(false)
    const selectedFile = event.dataTransfer.files[0]
    if (selectedFile) acceptFile(selectedFile)
  }, [acceptFile])

  const handleBackToUpload = useCallback(() => {
    setPreviewRows([])
    setProposed({})
    setSelectedRows({})
    setFiduciaryRows([])
    setSelectedFiduciaries({})
    setRejected([])
    resetFile()
  }, [resetFile])

  const handleImport = useCallback(async () => {
    if (!file) {
      toast.error('Choose a Word document first')
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    setSubmitting(true)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/import-docx`, {
        method: 'POST',
        body: formData,
      })
      const result = await response.json().catch(() => ({})) as ImportDocxResponse
      if (!response.ok) {
        throw new Error(result.error ?? `Import failed (${response.status})`)
      }

      const rows = Array.isArray(result.preview) ? result.preview : []
      setPreviewRows(rows)
      setProposed(result.proposed ?? {})
      setRejected(Array.isArray(result.rejected) ? result.rejected : [])
      setSelectedRows(buildSelectedRows(rows))
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Could not import design sheet')
    } finally {
      setSubmitting(false)
    }
  }, [file, matterId])

  /**
   * Ask the server for a proposal. Nothing is saved by this call — the response
   * populates the review list, and only `handleAccept` writes.
   */
  const handlePropose = useCallback(async () => {
    if (sourceMode === 'text' && pastedText.trim().length < MIN_DESIGN_SHEET_IMPORT_TEXT_LENGTH) {
      toast.error(`Paste at least ${MIN_DESIGN_SHEET_IMPORT_TEXT_LENGTH} characters`)
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/autofill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sourceMode === 'text'
            ? { source: 'text', text: pastedText.trim() }
            : { source: 'blockers' },
        ),
      })
      const result = await response.json().catch(() => ({})) as AutofillResponse
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)

      const rows = result.preview ?? []
      const people = result.fiduciaries ?? []
      setPreviewRows(rows)
      setProposed(result.proposed ?? {})
      setSelectedRows(buildSelectedRows(rows))
      setFiduciaryRows(people)
      setSelectedFiduciaries(Object.fromEntries(people.map(row => [row.id, row.selected])))
      setRejected(Array.isArray(result.rejected) ? result.rejected : [])

      if (rows.length === 0 && people.length === 0) {
        toast.info('Nothing new to propose from that source.')
      }
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Could not build a proposal')
    } finally {
      setSubmitting(false)
    }
  }, [matterId, pastedText, sourceMode])

  const handleAccept = useCallback(async () => {
    const acceptedFields: Record<string, unknown> = {}
    for (const row of previewRows) {
      if (selectedRows[row.field] && row.field in proposed) {
        acceptedFields[row.field] = (proposed as Record<string, unknown>)[row.field]
      }
    }
    const acceptedFiduciaries = fiduciaryRows.filter(row => selectedFiduciaries[row.id])

    if (Object.keys(acceptedFields).length === 0 && acceptedFiduciaries.length === 0) {
      toast.error('Select at least one proposed update')
      return
    }

    setSubmitting(true)
    try {
      // apply-proposal rather than the generic PATCH: a decision field has to be
      // folded into its `decisions` namespace and a new fiduciary may need a
      // contact row first, both of which have to happen against the stored sheet.
      const response = await fetch(`/api/admin/matters/${matterId}/design-sheet/apply-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetId: currentSheet?.id || null,
          expectedUpdatedAt: expectedUpdatedAt ?? currentSheet?.updated_at ?? null,
          fields: acceptedFields,
          fiduciaries: acceptedFiduciaries,
        }),
      })
      const result = await response.json().catch(() => ({})) as ApplyProposalResponse
      if (!response.ok) {
        throw new Error(result.conflict
          ? 'The design sheet changed while you were reviewing. Reload and run this again.'
          : result.error ?? `Save failed (${response.status})`)
      }

      onAccepted?.(acceptedFields as DesignSheetImportProposal, acceptedFiduciaries.length)
      toast.success('Design sheet updates saved')
      onOpenChange(false)
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Could not save design sheet updates')
    } finally {
      setSubmitting(false)
    }
  }, [
    currentSheet, expectedUpdatedAt, fiduciaryRows, matterId, onAccepted, onOpenChange,
    previewRows, proposed, selectedFiduciaries, selectedRows,
  ])

  return (
    <Dialog open={open} onOpenChange={nextOpen => { if (!submitting) onOpenChange(nextOpen) }}>
      <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <WandSparkles className="h-4 w-4 text-primary" />
            Complete Design Sheet
          </DialogTitle>
          <DialogDescription>
            Nothing is saved until you accept it. Every proposed value is reviewed field by field.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {!hasPreview ? (
            <div className="space-y-4">
              {allowUpload && (
                <div className="grid gap-2 sm:grid-cols-3">
                  {SOURCE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSourceMode(option.value)}
                      disabled={submitting}
                      aria-pressed={sourceMode === option.value}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                        sourceMode === option.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {option.hint}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <RejectedValues rejected={rejected} />

              {!allowUpload ? (
                <div className="rounded-md border bg-muted/40 px-4 py-5 text-sm text-muted-foreground">
                  No proposed design sheet updates are ready to review.
                </div>
              ) : sourceMode === 'gaps' ? (
                <div className="rounded-md border bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
                  Reviews what this design sheet is still missing and proposes values from the
                  matter&rsquo;s own record &mdash; intake, the people on the matter, the asset
                  schedule, recent meeting notes, and your saved standards.
                </div>
              ) : sourceMode === 'text' ? (
                <Textarea
                  value={pastedText}
                  onChange={event => setPastedText(event.target.value)}
                  disabled={submitting}
                  rows={10}
                  placeholder="Paste a meeting note, an email, or the client's answers..."
                  aria-label="Notes to read"
                />
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={event => {
                      event.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    disabled={submitting}
                    className={cn(
                      'flex min-h-44 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-background px-6 py-8 text-center transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60',
                      dragOver && 'border-primary bg-muted/60',
                    )}
                  >
                    <Upload className="h-7 w-7 text-muted-foreground" />
                    <span className="text-sm font-medium">Choose or drop a Word design sheet</span>
                    <span className="text-xs text-muted-foreground">DOCX only. 10 MB max.</span>
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
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={resetFile}
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
          ) : (
            <div className="space-y-3">
              <RejectedValues rejected={rejected} />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Proposed updates</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedCount} of {previewRows.length} field
                    {previewRows.length === 1 ? '' : 's'} selected
                    {fiduciaryRows.length > 0
                      ? `, ${selectedFiduciaryCount} of ${fiduciaryRows.length} ${fiduciaryRows.length === 1 ? 'person' : 'people'}`
                      : ''}
                  </p>
                </div>
                <div className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  Review before save
                </div>
              </div>

              {fiduciaryRows.length > 0 && (
                <div className="rounded-md border">
                  <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    People
                  </div>
                  <div className="divide-y">
                    {fiduciaryRows.map(row => (
                      <label
                        key={row.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 px-3 py-3 text-sm transition-colors hover:bg-muted/40',
                          row.replacement && 'bg-warning/10',
                        )}
                      >
                        <span className="pt-0.5">
                          <Checkbox
                            checked={Boolean(selectedFiduciaries[row.id])}
                            onCheckedChange={checked => {
                              setSelectedFiduciaries(prev => ({ ...prev, [row.id]: checked === true }))
                            }}
                            disabled={submitting}
                            aria-label={`Accept ${row.fullName} as ${row.label}`}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{row.label}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {row.currentDisplay === '-'
                              ? 'Currently unfilled'
                              : `Currently ${row.currentDisplay}`}
                          </span>
                        </span>
                        <span className="min-w-0 text-right">
                          <span className="block font-medium">{row.fullName}</span>
                          <span
                            className={cn(
                              'mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium',
                              row.matchedContactId
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-primary/10 text-primary',
                            )}
                          >
                            {row.matchedContactId ? 'Existing contact' : 'Creates a new contact'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {previewRows.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <div className="min-w-[720px]">
                    <div className="grid grid-cols-[40px_minmax(140px,0.9fr)_minmax(110px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      <span />
                      <span>Field</span>
                      <span>Section</span>
                      <span>Current</span>
                      <span>Proposed</span>
                    </div>
                    <div className="max-h-[44vh] divide-y overflow-y-auto">
                      {previewRows.map(row => (
                        <label
                          key={row.field}
                          className={cn(
                            'grid cursor-pointer grid-cols-[40px_minmax(140px,0.9fr)_minmax(110px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-3 text-sm transition-colors hover:bg-muted/40',
                            row.replacement && 'bg-warning/10',
                          )}
                        >
                          <span className="pt-0.5">
                            <Checkbox
                              checked={Boolean(selectedRows[row.field])}
                              onCheckedChange={checked => {
                                setSelectedRows(prev => ({ ...prev, [row.field]: checked === true }))
                              }}
                              disabled={submitting}
                              aria-label={`Accept ${row.label}`}
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{row.label}</span>
                            {row.replacement && (
                              <span className="mt-1 inline-flex rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                                Replacement
                              </span>
                            )}
                          </span>
                          <span className="truncate text-muted-foreground">{row.section}</span>
                          <span className="min-w-0 whitespace-pre-wrap break-words text-muted-foreground">
                            {row.currentDisplay}
                          </span>
                          <span className="min-w-0 whitespace-pre-wrap break-words font-medium">
                            {row.proposedDisplay}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          {hasPreview ? (
            <>
              {allowUpload && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBackToUpload}
                  disabled={submitting}
                >
                  Start over
                </Button>
              )}
              <Button
                type="button"
                onClick={handleAccept}
                disabled={submitting}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Accept selected
              </Button>
            </>
          ) : sourceMode === 'upload' ? (
            <Button
              type="button"
              onClick={handleImport}
              disabled={submitting || !file || !allowUpload}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Read document
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handlePropose}
              disabled={submitting || !allowUpload}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
              {sourceMode === 'text' ? 'Read notes' : 'Propose values'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
