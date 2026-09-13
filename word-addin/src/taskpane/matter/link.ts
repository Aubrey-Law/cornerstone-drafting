/**
 * Which matter a document is being drafted against.
 *
 * Stored in `localStorage`, keyed by the document's path — deliberately NOT in
 * `Office.context.document.settings`, for the same reason the access token is
 * not: document settings are written into the .docx, so the link would travel
 * with the file. An access token there would be a credential leak; a matter id
 * there is a quieter one — an internal identifier for a named client, embedded
 * in a document the firm emails to that client and to beneficiaries. Neither
 * belongs in something the firm hands out.
 *
 * The cost is that the link is per-machine: the same document opened on another
 * computer starts unlinked. That is the right side to fail on, and re-linking is
 * two clicks.
 */

const STORAGE_PREFIX = 'cornerstone.addin.matter.v1:'

export interface LinkedMatter {
  id: string
  matterNumber: string | null
  clientName: string
}

/**
 * The storage key for a document, or null when there cannot be one.
 *
 * An unsaved document has no URL, and every unsaved document would otherwise
 * share a single key — so opening a second one would inherit the first one's
 * matter. A null key means "hold the link in memory for this session only",
 * which is the honest behaviour for a file with no identity yet.
 */
export function documentKey(url: string | null | undefined): string | null {
  const trimmed = (url ?? '').trim()
  return trimmed ? `${STORAGE_PREFIX}${trimmed}` : null
}

/** The open document's key. Returns null in a browser test host with no Office. */
export function currentDocumentKey(): string | null {
  try {
    return documentKey(Office.context.document.url)
  } catch {
    return null
  }
}

function isLinkedMatter(value: unknown): value is LinkedMatter {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id.length > 0 && typeof row.clientName === 'string'
}

export function loadLink(key: string | null): LinkedMatter | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isLinkedMatter(parsed) ? parsed : null
  } catch {
    // Private mode, quota, or a value written by an older shape. An unlinked
    // pane is a working pane, so none of those is worth surfacing.
    return null
  }
}

export function storeLink(key: string | null, matter: LinkedMatter): void {
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(matter))
  } catch {
    /* The link still holds for this session; it just will not be remembered. */
  }
}

export function clearLink(key: string | null): void {
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing useful to do */
  }
}
