import { supabase } from '@/lib/supabaseClient'
import type { DocumentAccessAudit, MatterDocument, MatterDocumentFolder } from '@/types/database'

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
  onProgress?: (pct: number) => void,
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const form = new FormData()
  form.append('file', file)
  form.append('matterId', matterId)

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

/**
 * Combine Word documents — in the given order — into a single .docx and
 * download it. Each document keeps its own formatting in the combined file.
 */
export async function combineWordDocuments(docIds: string[], filename?: string): Promise<void> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch('/api/documents/combine', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ docIds, filename }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    // Include the status when the body isn't our JSON error — a platform-level
    // failure (timeout, crash page) is otherwise indistinguishable.
    throw new Error(body?.error ?? `Failed to combine selected documents (HTTP ${res.status})`)
  }

  const disposition = res.headers.get('content-disposition') ?? ''
  // Prefer the RFC 5987 filename* (exact name, UTF-8) over the ASCII fallback.
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const filenameMatch = disposition.match(/filename="([^"]+)"/)
  let downloadName = filenameMatch?.[1] ?? 'combined-documents.docx'
  if (encodedMatch) {
    try {
      downloadName = decodeURIComponent(encodedMatch[1])
    } catch {
      // keep the ASCII fallback
    }
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = downloadName
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

/** Show or hide a document in the client portal. */
export async function setDocumentShared(
  docId: string,
  shared: boolean,
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ shared }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Failed to update sharing')
  }
  const { document } = await res.json()
  return document as MatterDocument
}

/**
 * Mark a generated draft as attorney-reviewed (or clear it). Recorded with the
 * reviewer + timestamp. Informational only — it gates nothing.
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

export async function getDocumentAuditEvents({
  matterId,
  documentId,
  limit = 25,
}: {
  matterId: string
  documentId?: string
  limit?: number
}): Promise<DocumentAccessAudit[]> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const params = new URLSearchParams({ matterId, limit: String(limit) })
  if (documentId) params.set('documentId', documentId)

  const res = await fetch(`/api/admin/documents/audit?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? 'Failed to load document audit history')
  return (body.events ?? []) as DocumentAccessAudit[]
}

/** List documents for a matter, optionally filtered by provenance. */
export async function listDocuments(
  matterId: string,
  source?: MatterDocument['source'],
): Promise<MatterDocument[]> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const params = new URLSearchParams({ matterId })
  if (source) params.set('source', source)

  const res = await fetch(`/api/documents?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const { documents } = await res.json()
  return documents ?? []
}

/** List the attorney-created folders for a matter. */
export async function listDocumentFolders(matterId: string): Promise<MatterDocumentFolder[]> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/folders?matterId=${encodeURIComponent(matterId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const { folders } = await res.json()
  return (folders ?? []) as MatterDocumentFolder[]
}

export async function createDocumentFolder(
  matterId: string,
  name: string,
): Promise<MatterDocumentFolder> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch('/api/documents/folders', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ matterId, name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? 'Could not create folder')
  return body.folder as MatterDocumentFolder
}

export async function renameDocumentFolder(
  folderId: string,
  name: string,
): Promise<MatterDocumentFolder> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/folders/${folderId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? 'Could not rename folder')
  return body.folder as MatterDocumentFolder
}

/** Delete a folder. Its documents survive and fall back to the workspace root. */
export async function deleteDocumentFolder(folderId: string): Promise<void> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/folders/${folderId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error ?? 'Could not delete folder')
  }
}

/** File a document into a folder, or pass null to move it back to the root. */
export async function moveDocumentToFolder(
  docId: string,
  folderId: string | null,
): Promise<MatterDocument> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`/api/documents/${docId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ folderId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? 'Could not move document')
  return body.document as MatterDocument
}
