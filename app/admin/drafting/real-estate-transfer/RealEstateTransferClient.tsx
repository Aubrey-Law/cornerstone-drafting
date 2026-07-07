'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { Download, FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import {
  DOCUMENT_TYPES,
  emptyRealEstateTransferFields,
  FIELD_SECTION_LABELS,
  REAL_ESTATE_TRANSFER_DOC_TYPES,
  REAL_ESTATE_TRANSFER_FIELDS,
  type RealEstateTransferDocType,
  type RealEstateTransferFieldKey,
  type RealEstateTransferFields,
} from '@/lib/realEstateTransfer/fields'

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/filename="([^"]+)"/)
  return match?.[1] ?? null
}

export default function RealEstateTransferClient() {
  const accessToken = useAccessToken()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fields, setFields] = useState<RealEstateTransferFields>(emptyRealEstateTransferFields())
  const [selectedDocs, setSelectedDocs] = useState<Set<RealEstateTransferDocType>>(
    () => new Set(REAL_ESTATE_TRANSFER_DOC_TYPES),
  )
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [hasExtracted, setHasExtracted] = useState(false)
  const [busy, setBusy] = useState<'extract' | 'generate' | null>(null)
  const [isPending, startTransition] = useTransition()

  const fieldsBySection = useMemo(() => {
    const grouped = new Map<string, typeof REAL_ESTATE_TRANSFER_FIELDS>()
    for (const field of REAL_ESTATE_TRANSFER_FIELDS) {
      const list = grouped.get(field.section) ?? []
      list.push(field)
      grouped.set(field.section, list)
    }
    return grouped
  }, [])

  const updateField = (key: RealEstateTransferFieldKey, value: string) => {
    setFields(current => ({ ...current, [key]: value }))
  }

  const toggleDoc = (docType: RealEstateTransferDocType) => {
    setSelectedDocs(current => {
      const next = new Set(current)
      if (next.has(docType)) next.delete(docType)
      else next.add(docType)
      return next
    })
  }

  const handleUpload = (file: File | null) => {
    if (!file || busy) return
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }

    setBusy('extract')
    setUploadName(file.name)
    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch('/api/drafting/real-estate-transfer/extract', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })

        const data = await response.json().catch(() => ({})) as {
          error?: string
          fields?: RealEstateTransferFields
        }

        if (!response.ok) {
          toast.error(data.error ?? 'Could not extract fields from the deed PDF.')
          return
        }

        setFields(data.fields ?? emptyRealEstateTransferFields())
        setHasExtracted(true)
        toast.success('Fields extracted from deed PDF.')
      } catch {
        toast.error('Network error. Please try again.')
      } finally {
        setBusy(null)
      }
    })
  }

  const handleGenerate = () => {
    if (busy) return
    if (!accessToken) {
      toast.error('Your session expired. Refresh and try again.')
      return
    }
    if (selectedDocs.size === 0) {
      toast.error('Select at least one document to generate.')
      return
    }

    setBusy('generate')
    startTransition(async () => {
      try {
        const response = await fetch('/api/drafting/real-estate-transfer/generate', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fields,
            documents: Array.from(selectedDocs),
          }),
        })

        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string }
          toast.error(data.error ?? 'Document generation failed.')
          return
        }

        const blob = await response.blob()
        const filename = parseContentDispositionFilename(response.headers.get('Content-Disposition'))
          ?? (selectedDocs.size === 1 ? 'document.docx' : 'real-estate-transfer.zip')
        triggerBlobDownload(blob, filename)
        toast.success('Documents generated.')
      } catch {
        toast.error('Network error. Please try again.')
      } finally {
        setBusy(null)
      }
    })
  }

  const working = busy !== null || isPending

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Upload deed PDF</CardTitle>
          <CardDescription>
            Upload the current deed. Text-based and scanned PDFs are supported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0] ?? null
              handleUpload(file)
              event.target.value = ''
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={working}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy === 'extract' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <FileUp className="mr-2 h-4 w-4" aria-hidden />
            )}
            {uploadName ? 'Upload a different PDF' : 'Choose PDF'}
          </Button>
          {uploadName && (
            <p className="text-xs text-muted-foreground">
              Current file: {uploadName}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Review & edit fields</CardTitle>
          <CardDescription>
            {hasExtracted
              ? 'Confirm extracted values before generating documents.'
              : 'Upload a deed PDF to populate these fields, or enter values manually.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {[...fieldsBySection.entries()].map(([section, sectionFields]) => (
            <div key={section} className="space-y-3">
              <h3 className="text-sm font-medium">{FIELD_SECTION_LABELS[section as keyof typeof FIELD_SECTION_LABELS]}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {sectionFields.map(field => (
                  <div
                    key={field.key}
                    className={field.multiline ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}
                  >
                    <Label htmlFor={field.key}>{field.label}</Label>
                    {field.multiline ? (
                      <Textarea
                        id={field.key}
                        value={fields[field.key] ?? ''}
                        onChange={event => updateField(field.key, event.target.value)}
                        rows={4}
                      />
                    ) : (
                      <Input
                        id={field.key}
                        value={fields[field.key] ?? ''}
                        onChange={event => updateField(field.key, event.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Generate documents</CardTitle>
          <CardDescription>
            Choose which documents to create. Multiple selections download as a ZIP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {REAL_ESTATE_TRANSFER_DOC_TYPES.map(docType => (
              <label
                key={docType}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <Checkbox
                  checked={selectedDocs.has(docType)}
                  onCheckedChange={() => toggleDoc(docType)}
                />
                <span className="text-sm">{DOCUMENT_TYPES[docType].label}</span>
              </label>
            ))}
          </div>
          <Button type="button" disabled={working || selectedDocs.size === 0} onClick={handleGenerate}>
            {busy === 'generate' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="mr-2 h-4 w-4" aria-hidden />
            )}
            Generate selected
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
