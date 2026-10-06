'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { uploadDocument } from '@/lib/documents'
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from '@/lib/documentUpload'
import { clientStatusLabel, type DocumentRequest } from '@/lib/documentRequests/model'
import { cn } from '@/lib/utils'

const ACCEPT_ATTR = '.pdf,.doc,.docx,.xlsx,.csv,.txt,.md,.jpg,.jpeg,.png,.tif,.tiff'

export interface RequestedDocumentsProps {
  matterId: string
  matterClosed: boolean
  requests: DocumentRequest[]
  /** Today in the firm's calendar, for the overdue label. */
  today: string
}

/**
 * The list of what the firm has asked for, each with its own upload. Uploading
 * against a request files the document and marks the request received, so the
 * client sees it move from "Requested" to "Received" without anyone typing.
 */
export default function RequestedDocuments({ matterId, matterClosed, requests: initial, today }: RequestedDocumentsProps) {
  const [requests, setRequests] = useState(initial)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  if (requests.length === 0) return null

  async function handleFile(request: DocumentRequest, files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`${file.name} is larger than the upload limit.`)
      return
    }
    if (file.type && !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      toast.error(`${file.name}: file type not accepted.`)
      return
    }
    setUploadingId(request.id)
    try {
      await uploadDocument(file, matterId, undefined, { requestId: request.id })
      setRequests(current => current.map(row => row.id === request.id
        ? { ...row, status: 'received', receivedAt: new Date().toISOString() }
        : row))
      toast.success(`${file.name} received. Thank you.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed')
    } finally {
      setUploadingId(null)
      const input = inputRefs.current[request.id]
      if (input) input.value = ''
    }
  }

  const owed = requests.filter(request => request.status === 'requested').length

  return (
    <section id="requests" className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">What we need from you</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {owed === 0
          ? 'Everything we asked for has arrived. Thank you.'
          : owed === 1
            ? 'One item is still outstanding. Upload it here when you have it.'
            : `${owed} items are still outstanding. Upload each one here when you have it.`}
      </p>
      <ul className="mt-4 divide-y divide-border/60">
        {requests.map(request => {
          const open = request.status === 'requested'
          const uploading = uploadingId === request.id
          return (
            <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{request.title}</p>
                {request.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{request.description}</p>
                )}
                <p className={cn('mt-1 flex items-center gap-1 text-xs', open ? 'text-muted-foreground' : 'text-foreground/80')}>
                  {open ? <Clock className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5 text-primary" aria-hidden />}
                  {clientStatusLabel(request, today)}
                </p>
              </div>
              {open && !matterClosed && (
                <div>
                  <input
                    ref={element => { inputRefs.current[request.id] = element }}
                    type="file"
                    accept={ACCEPT_ATTR}
                    className="hidden"
                    aria-label={`Upload ${request.title}`}
                    onChange={event => void handleFile(request, event.target.files)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={uploading}
                    onClick={() => inputRefs.current[request.id]?.click()}
                  >
                    {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                    {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
