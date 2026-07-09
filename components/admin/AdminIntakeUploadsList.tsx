'use client'

import { useEffect, useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  INTAKE_DOCUMENT_KIND_LABELS,
  type IntakeDocumentKind,
  type IntakeDocumentRow,
} from '@/lib/intake/intakeDocumentColumns'
import { formatDate } from '@/lib/utils'

const VALID_KINDS = new Set<IntakeDocumentKind>([
  'general',
  'existing_plan',
  'divorce_settlement',
  'gift_tax_return',
])

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function kindLabel(kind: string): string {
  if (VALID_KINDS.has(kind as IntakeDocumentKind)) {
    return INTAKE_DOCUMENT_KIND_LABELS[kind as IntakeDocumentKind]
  }
  return INTAKE_DOCUMENT_KIND_LABELS.general
}

export function AdminIntakeUploadsList({ intakeId }: { intakeId: string | null }) {
  const [documents, setDocuments] = useState<IntakeDocumentRow[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!intakeId) {
      setDocuments([])
      return
    }

    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/intake/${encodeURIComponent(intakeId)}/documents`)
        if (!res.ok) throw new Error('Could not load questionnaire uploads')
        const body = await res.json() as { documents?: IntakeDocumentRow[] }
        if (!cancelled) setDocuments(body.documents ?? [])
      } catch (e) {
        if (!cancelled) {
          setDocuments([])
          toast.error(e instanceof Error ? e.message : 'Could not load questionnaire uploads')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [intakeId])

  async function handleDownload(doc: IntakeDocumentRow) {
    setDownloadingId(doc.id)
    try {
      const res = await fetch(`/api/admin/intake/documents/${encodeURIComponent(doc.id)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Download failed')
      }
      const body = await res.json() as { url?: string }
      if (!body.url) throw new Error('Download failed')
      window.open(body.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  if (!intakeId) return null

  return (
    <>
      <div style={{
        fontSize: 11, fontWeight: 500, textTransform: 'uppercase' as const,
        letterSpacing: '0.05em', color: 'var(--muted-foreground)',
        marginTop: 24, marginBottom: 10,
      }}>
        Questionnaire uploads
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted-foreground)' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading uploads…
        </div>
      ) : documents.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
          No files uploaded with the questionnaire yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--card)',
                padding: '10px 12px',
              }}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
                  {kindLabel(doc.kind)} · {formatSize(doc.size)} · {formatDate(doc.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDownload(doc)}
                disabled={downloadingId === doc.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--accent)',
                  background: 'transparent',
                  border: 'none',
                  cursor: downloadingId === doc.id ? 'wait' : 'pointer',
                  opacity: downloadingId === doc.id ? 0.6 : 1,
                  flexShrink: 0,
                }}
              >
                {downloadingId === doc.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
