import { supabase } from '@/lib/supabaseClient'
import type { MatterDocument } from '@/types/database'

const WORD_CONTENT_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export function isWordDocument(name: string, contentType?: string | null): boolean {
  const lowerName = name.toLowerCase()
  return (
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx') ||
    (contentType ? WORD_CONTENT_TYPES.has(contentType) : false)
  )
}

export function isPdfDocument(name: string, contentType?: string | null): boolean {
  return contentType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}

export function toMicrosoftOfficeViewerUrl(url: string, mode: 'view' | 'embed' = 'view'): string {
  return `https://view.officeapps.live.com/op/${mode}.aspx?src=${encodeURIComponent(url)}`
}

/** Upload a file via the app proxy (R2 + DB). Returns the new MatterDocument. */
export async function uploadDocument(
  file: File,
  matterId: string,
  folder: MatterDocument['folder'] = 'client',
  onProgress?: (pct: number) => void,
  folderId?: string | null,
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const form = new FormData()
  form.append('file', file)
  form.append('matterId', matterId)
  form.append('folder', folder)
  if (folderId) form.append('folderId', folderId)

  const document = await new Promise<MatterDocument>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/documents/upload')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { error?: string }
          reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`))
        }
        return
      }
      try {
        const body = JSON.parse(xhr.responseText) as { document: MatterDocument }
        resolve(body.document)
      } catch {
        reject(new Error('Invalid upload response'))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(form)
  })

  return document
}

/** Get a short-lived signed download URL for a document. */
export async function getDocumentUrl(docId: string, action: 'view' | 'download' = 'download'): Promise<string> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}?action=${action}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to get download URL')
  const { url } = await res.json()
  return url
}

export async function downloadDocumentsZip(docIds: string[]): Promise<void> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch('/api/documents/bulk-download', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ docIds }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to download selected documents')
  }

  const disposition = res.headers.get('content-disposition') ?? ''
  const filenameMatch = disposition.match(/filename="([^"]+)"/)
  const filename = filenameMatch?.[1] ?? 'documents.zip'
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Get a URL suitable for a browser preview. Word files use Microsoft's renderer. */
export async function getDocumentViewerUrl(
  docId: string,
  name: string,
  contentType?: string | null,
  options: { embed?: boolean } = {},
): Promise<string> {
  const url = await getDocumentUrl(docId, 'view')
  return isWordDocument(name, contentType)
    ? toMicrosoftOfficeViewerUrl(url, options.embed ? 'embed' : 'view')
    : url
}

/** Render a DOCX document to HTML for in-app viewing. */
export async function getDocumentPreview(docId: string): Promise<{ html: string }> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}/preview`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? 'Failed to load document preview')
  return { html: String(body.html ?? '') }
}

/** Delete a document from R2 and the database. */
export async function deleteDocument(docId: string): Promise<void> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Failed to delete document')
}

/**
 * Update a document's folder. Set `confirmed: true` when the caller has
 * already shown the attorney-review-gate confirmation modal (required by the
 * server when moving a draft to a client-visible folder).
 */
export async function updateDocumentFolder(
  docId: string,
  folder: MatterDocument['folder'],
  options: { confirmed?: boolean } = {},
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ folder, confirmed: options.confirmed === true }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to update document folder')
  }
  const { document } = await res.json()
  return document as MatterDocument
}

/** Convert an internal Word draft to PDF via Microsoft Graph and share with the client. */
export async function convertAndShareDraftPdf(
  matterId: string,
  docId: string,
  toFolder: 'review' | 'signed' | 'final' = 'review',
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/admin/matters/${matterId}/documents/${docId}/share-pdf`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ toFolder }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to convert and share PDF')
  }
  const { document } = await res.json()
  return document as MatterDocument
}

/**
 * Mark a generated draft as attorney-reviewed (or clear it). Recorded with the
 * reviewer + timestamp and required by the server before a draft can be
 * promoted to a client-visible folder.
 */
export async function setDocumentReviewed(docId: string, reviewed: boolean): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ reviewed }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to update review status')
  }
  const { document } = await res.json()
  return document as MatterDocument
}

/** Rename a document (update its display title). Returns the updated row. */
export async function renameDocument(docId: string, name: string): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to rename document')
  }
  const { document } = await res.json()
  return document as MatterDocument
}

/** List documents for a matter, optionally filtered by folder. */
export async function listDocuments(matterId: string, folder?: string): Promise<MatterDocument[]> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const params = new URLSearchParams({ matterId })
  if (folder) params.set('folder', folder)

  const res = await fetch(`/api/documents?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const { documents } = await res.json()
  return documents ?? []
}
