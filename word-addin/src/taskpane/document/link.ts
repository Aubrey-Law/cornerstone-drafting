/**
 * Which Cornerstone document the open file is a copy of.
 *
 * Separate from the matter link and stored the same way — `localStorage`, keyed
 * by the document's path, never `Office.context.document.settings`, which are
 * written into the `.docx` and would travel with the file to whoever received
 * it.
 *
 * `baseVersionId` is the version that was current when the link was made. It is
 * sent back on save so the server can refuse to bury a version saved by someone
 * else in the meantime. It is a claim about when the link was made, not about
 * the file's contents: nothing inside a `.docx` records which version it was
 * downloaded from, so an attorney who opened a stale copy and linked it will
 * pass this check. That is why the pane shows the version it is about to
 * supersede rather than only asking for confirmation.
 */

const STORAGE_PREFIX = 'cornerstone.addin.document.v1:'

export interface LinkedDocument {
  id: string
  name: string
  /** The current version at link time, or null if the document had none yet. */
  baseVersionId: string | null
}

export function documentLinkKey(url: string | null | undefined): string | null {
  const trimmed = (url ?? '').trim()
  return trimmed ? `${STORAGE_PREFIX}${trimmed}` : null
}

/** The open document's key. Returns null in a test host with no Office. */
export function currentDocumentLinkKey(): string | null {
  try {
    return documentLinkKey(Office.context.document.url)
  } catch {
    return null
  }
}

function isLinkedDocument(value: unknown): value is LinkedDocument {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.name === 'string' &&
    (typeof row.baseVersionId === 'string' || row.baseVersionId === null)
  )
}

export function loadDocumentLink(key: string | null): LinkedDocument | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isLinkedDocument(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function storeDocumentLink(key: string | null, document: LinkedDocument): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(document))
  } catch {
    /* The link holds for this session; it just will not be remembered. */
  }
}

export function clearDocumentLink(key: string | null): void {
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing useful to do */
  }
}
