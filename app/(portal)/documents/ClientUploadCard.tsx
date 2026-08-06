'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/lib/documents'
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/documentUpload'
import type { MatterDocument } from '@/types/database'
import { formatDate } from '@/lib/utils'

const ACCEPT_ATTR = '.pdf,.doc,.docx,.xlsx,.csv,.txt,.md,.jpg,.jpeg,.png,.tif,.tiff'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export type Props = {
  matterId: string
  matterClosed: boolean
  initialUploads: MatterDocument[]
}

export default function ClientUploadCard({ matterId, matterClosed, initialUploads }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploads, setUploads] = useState<MatterDocument[]>(initialUploads)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setProgress(0)

    const list = Array.from(files)
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name}: file is larger than ${formatSize(MAX_UPLOAD_BYTES)}.`)
        continue
      }
      if (file.type && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
        toast.error(`${file.name}: file type not accepted.`)
        continue
      }
      try {
        const doc = await uploadDocument(file, matterId, (pct) => setProgress(pct))
        setUploads((prev) => [doc, ...prev])
        toast.success(`${file.name} uploaded`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `${file.name}: upload failed`)
      }
    }

    setProgress(null)
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (matterClosed) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground">Need to send us something?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This matter is closed. Contact your attorney to share new documents.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Need to send us something?</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, Word, Excel, CSV, text, or image — {formatSize(MAX_UPLOAD_BYTES)} max.
          </p>
        </div>
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="gap-2"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Upload files'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {progress !== null && (
        <div className="mt-4">
          <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="mt-4 space-y-2">
          {uploads.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate font-medium text-foreground">{doc.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatSize(doc.size)} · {formatDate(doc.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
