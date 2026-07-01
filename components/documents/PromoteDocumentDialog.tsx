'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { MatterDocument } from '@/types/database'
import { isWordDocument } from '@/lib/documents'

type PromotableDocument = {
  folder: MatterDocument['folder']
  name: string
  size: number
  // Draft review state (optional — present for generated drafts). Snake_case to
  // match the MatterDocument rows passed straight through from the documents tab.
  marker_count?: number | null
  reviewed_at?: string | null
}

const FOLDER_LABEL: Record<MatterDocument['folder'], string> = {
  draft:           'Internal drafts',
  client:          'Client uploads',
  review:          'Shared drafts',
  signed:          'Signed documents',
  final:           'Signed documents',
  intake:          'Intake materials',
  'meeting-notes': 'Meeting notes',
}

interface Props {
  pending: { doc: PromotableDocument; toFolder: MatterDocument['folder'] } | null
  onCancel: () => void
  onConfirm: () => Promise<void>
}

export function PromoteDocumentDialog({ pending, onCancel, onConfirm }: Props) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!pending) {
      setAcknowledged(false)
      setSubmitting(false)
    }
  }, [pending])

  if (!pending) return null

  const { doc, toFolder } = pending

  const isIntakeMove = toFolder === 'intake'
  const isReviewMove = toFolder === 'review'
  const isWordDoc = isWordDocument(doc.name)
  const isClientVisibleMove = toFolder === 'review' || toFolder === 'signed' || toFolder === 'final'

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {isWordDoc && isClientVisibleMove
              ? 'Word files cannot be shared with clients'
              : isIntakeMove
                ? 'Move to intake materials?'
                : isReviewMove
                  ? 'Share this PDF with the client?'
                  : 'Share this document with the client?'}
          </DialogTitle>
          <DialogDescription>
            {isWordDoc && isClientVisibleMove ? (
              <>
                <span className="font-semibold">{doc.name}</span> is a Word document. Clients only see PDFs.
                Export a PDF from Word, upload it to a shared folder, or use Convert &amp; share PDF in the drafting workspace.
              </>
            ) : (
              <>
                This document is currently <span className="font-semibold">internal — not shared with the client</span>.
                Moving it to <span className="font-semibold">{FOLDER_LABEL[toFolder]}</span> will make it visible in the
                client&apos;s portal immediately.
                {isIntakeMove && (
                  <span className="block mt-1 text-xs">
                    Use this when a file was uploaded to internal drafts but belongs with intake materials.
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!(isWordDoc && isClientVisibleMove) && (
        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="font-medium text-foreground">{doc.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Currently in <span className="font-medium">{FOLDER_LABEL[doc.folder]}</span> · {Math.round(doc.size / 1024)} KB
            </p>
            {(doc.marker_count != null || doc.reviewed_at != null) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {doc.marker_count === 0
                  ? <span className="font-medium text-emerald-700">✓ Marker-clean</span>
                  : typeof doc.marker_count === 'number' && doc.marker_count > 0
                    ? <span className="font-medium text-amber-700">⚠ {doc.marker_count} unresolved marker{doc.marker_count === 1 ? '' : 's'}</span>
                    : null}
                {doc.reviewed_at
                  ? <span className="font-medium text-emerald-700">{doc.marker_count != null ? ' · ' : ''}✓ Reviewed</span>
                  : doc.marker_count != null
                    ? <span> · Not yet marked reviewed</span>
                    : null}
              </p>
            )}
          </div>

          <label className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              I have reviewed this document for legal accuracy and confirm it is appropriate to share with the client.
              <span className="block mt-1 text-xs text-amber-800/80">
                This step is required by Mass. R.P.C. 1.1 (competence) and 5.3 (supervision of nonlawyer assistance).
                The promotion will be recorded in the document audit log with your name and timestamp.
              </span>
            </span>
          </label>
        </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            {isWordDoc && isClientVisibleMove ? 'Close' : 'Cancel'}
          </Button>
          {!(isWordDoc && isClientVisibleMove) && (
          <Button
            disabled={!acknowledged || submitting}
            onClick={async () => {
              setSubmitting(true)
              try {
                await onConfirm()
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Moving…</> : isIntakeMove ? 'Move to intake materials' : `Share as ${FOLDER_LABEL[toFolder]}`}
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
