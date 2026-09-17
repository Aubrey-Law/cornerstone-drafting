'use client'

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { FileSpreadsheet, FileText, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseCurrencyInput } from '@/lib/assets/format'
import type { OwnershipLabels } from '@/lib/assets/labels'
import { ASSET_CATEGORIES, type AssetCategory, type Ownership } from '@/lib/estateTax'
import { cn } from '@/lib/utils'
import type { AssetIntakeInput } from '@/types/assetIntake'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const DEFAULT_ROW_COUNT = 3

const DOC_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
} as const

interface BulkAssetRow {
  id: string
  category: AssetCategory
  description: string
  valueInput: string
  ownership: Ownership
}

interface BulkAssetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  intakeId: string
  accessToken: string | null
  ownershipLabels: OwnershipLabels
  onSaved: (count: number) => void
}

function newRow(): BulkAssetRow {
  return {
    id: crypto.randomUUID(),
    category: 'bank',
    description: '',
    valueInput: '',
    ownership: 'client',
  }
}

function emptyRows(count = DEFAULT_ROW_COUNT): BulkAssetRow[] {
  return Array.from({ length: count }, () => newRow())
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

export function BulkAssetsDialog({
  open,
  onOpenChange,
  intakeId,
  accessToken,
  ownershipLabels,
  onSaved,
}: BulkAssetsDialogProps) {
  const [tab, setTab] = useState<'rows' | 'import'>('rows')
  const [rows, setRows] = useState<BulkAssetRow[]>(emptyRows())
  const [savingRows, setSavingRows] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab('rows')
    setRows(emptyRows())
    resetImport()
  }, [open])

  function resetImport() {
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function updateRow(id: string, patch: Partial<BulkAssetRow>) {
    setRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)))
  }

  function addRow() {
    setRows(prev => [...prev, newRow()])
  }

  function removeRow(id: string) {
    setRows(prev => (prev.length <= 1 ? prev : prev.filter(row => row.id !== id)))
  }

  function rowsToAssets(): AssetIntakeInput[] {
    return rows
      .map(row => ({
        category: row.category,
        description: row.description.trim(),
        value: parseCurrencyInput(row.valueInput),
        ownership: row.ownership,
        details: {},
      }))
      .filter(asset => asset.description)
  }

  async function handleSaveRows() {
    const assets = rowsToAssets()
    if (assets.length === 0) {
      toast.error('Enter at least one asset description')
      return
    }
    if (!accessToken) {
      toast.error('Not signed in')
      return
    }

    setSavingRows(true)
    try {
      const res = await fetch(`/api/admin/assets/${intakeId}/bulk`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assets }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save assets')

      const inserted = Number(data.inserted) || 0
      toast.success(`Added ${inserted} asset${inserted === 1 ? '' : 's'}`)
      onSaved(inserted)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save assets')
    } finally {
      setSavingRows(false)
    }
  }

  function acceptFile(selected: File) {
    if (!isSupportedAssetImportFile(selected)) {
      toast.error('Supported formats: PDF, Word .docx, Excel .xlsx, or .csv')
      resetImport()
      return
    }
    if (selected.size > MAX_IMPORT_BYTES) {
      toast.error('File is too large (10 MB max)')
      resetImport()
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

  async function handleImport() {
    if (!file) {
      toast.error('Choose a file to import')
      return
    }
    if (!accessToken) {
      toast.error('Not signed in')
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/admin/assets/${intakeId}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Import failed')

      const inserted = Number(data.inserted) || 0
      toast.success(inserted > 0 ? `Imported ${inserted} asset${inserted === 1 ? '' : 's'}` : 'No assets found in file')
      onSaved(inserted)
      resetImport()
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const filledRowCount = rowsToAssets().length
  const isSpreadsheet = file
    ? file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.csv')
    : false
  const busy = savingRows || importing

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value) resetImport()
        onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk assets</DialogTitle>
          <DialogDescription>
            Add multiple assets at once, or import from a spreadsheet or document. Exported asset reports (.xlsx) can be re-imported as-is.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={value => setTab(value as 'rows' | 'import')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="rows">Add rows</TabsTrigger>
            <TabsTrigger value="import">Import file</TabsTrigger>
          </TabsList>

          <TabsContent value="rows" className="space-y-3 pt-2">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Category</th>
                    <th className="px-2 py-2 font-medium">Description</th>
                    <th className="px-2 py-2 font-medium">Value</th>
                    <th className="px-2 py-2 font-medium">Ownership</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-t">
                      <td className="px-2 py-1.5 align-top">
                        <Select
                          value={row.category}
                          onValueChange={value => updateRow(row.id, { category: value as AssetCategory })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSET_CATEGORIES.map(cat => (
                              <SelectItem key={cat.key} value={cat.key}>
                                {cat.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <Input
                          value={row.description}
                          onChange={e => updateRow(row.id, { description: e.target.value })}
                          placeholder="Asset description"
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div className="relative">
                          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                            $
                          </span>
                          <Input
                            value={row.valueInput}
                            onChange={e => updateRow(row.id, { valueInput: e.target.value })}
                            placeholder="0"
                            inputMode="decimal"
                            className="h-8 pl-5 text-xs tabular-nums"
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <Select
                          value={row.ownership}
                          onValueChange={value => updateRow(row.id, { ownership: value as Ownership })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="client">{ownershipLabels.client}</SelectItem>
                            <SelectItem value="spouse">{ownershipLabels.spouse}</SelectItem>
                            <SelectItem value="joint">{ownershipLabels.joint}</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length <= 1}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" />
              Add row
            </Button>
          </TabsContent>

          <TabsContent value="import" className="space-y-3 pt-2">
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
              <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 text-sm">
                {isSpreadsheet ? (
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{fileKindLabel(file)}</p>
                </div>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={resetImport}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {tab === 'rows' ? (
            <Button type="button" onClick={() => void handleSaveRows()} disabled={busy || filledRowCount === 0}>
              {savingRows && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add {filledRowCount || ''} asset{filledRowCount === 1 ? '' : 's'}
            </Button>
          ) : (
            <Button type="button" onClick={() => void handleImport()} disabled={busy || !file}>
              {importing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import assets
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
