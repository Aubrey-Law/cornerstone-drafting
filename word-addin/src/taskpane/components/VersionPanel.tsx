import { useCallback, useEffect, useState } from 'react'
import {
  getDocumentVersions,
  listMatterDocuments,
  saveDocumentVersion,
  type DocumentVersions,
  type MatterDocument,
} from '../api/client'
import {
  MAX_UPLOAD_BASE64_CHARS,
  describeOversize,
  readDocumentBytes,
} from '../../word/readDocumentBytes'
import type { LinkedDocument } from '../document/link'

/**
 * The open document's place in Cornerstone's version history.
 *
 * The add-in shipped editing whatever file was open on disk while
 * `/api/documents/[id]/edits` wrote R2 versions, and the two never met — an
 * attorney's tracked changes lived in a local file the firm's record knew
 * nothing about. **Save this version** uploads the document as it stands and
 * makes it the document's next version.
 *
 * Nothing here is automatic. A version is a durable record of a legal document,
 * and the firm should get one because an attorney decided to make one, not
 * because a pane was open.
 */
export default function VersionPanel({
  matterId,
  linked,
  onLink,
  onUnlink,
}: {
  matterId: string | null
  linked: LinkedDocument | null
  onLink: (document: LinkedDocument) => void
  onUnlink: () => void
}) {
  if (!matterId) {
    return (
      <p className="p-3 text-[color:var(--color-ink-muted)]">
        Link a matter above to save this document into its version history.
      </p>
    )
  }

  return linked ? (
    <LinkedDocumentView linked={linked} onUnlink={onUnlink} />
  ) : (
    <DocumentPicker matterId={matterId} onLink={onLink} />
  )
}

function LinkedDocumentView({
  linked,
  onUnlink,
}: {
  linked: LinkedDocument
  onUnlink: () => void
}) {
  const [history, setHistory] = useState<DocumentVersions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setHistory(await getDocumentVersions(linked.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the version history.')
    }
  }, [linked.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const fileBase64 = await readDocumentBytes()
      if (fileBase64.length > MAX_UPLOAD_BASE64_CHARS) {
        setError(describeOversize(fileBase64.length))
        return
      }

      const result = await saveDocumentVersion(linked.id, {
        fileBase64,
        baseVersionId: linked.baseVersionId,
      })
      setMessage(
        `Saved as version ${result.versionNumber}.` +
          (result.markerCount > 0
            ? ` ${result.markerCount} unresolved placeholder${result.markerCount === 1 ? '' : 's'} in it.`
            : ''),
      )
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the version.')
    } finally {
      setSaving(false)
    }
  }

  const current = history?.versions.find(v => v.id === history.currentVersionId)

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{linked.name}</div>
          <div className="text-[11px] text-[color:var(--color-ink-muted)]">
            {current ? `Currently version ${current.versionNumber}` : 'No versions yet'}
          </div>
        </div>
        <button
          type="button"
          onClick={onUnlink}
          className="shrink-0 text-xs text-[color:var(--color-ink-muted)] underline"
        >
          Unlink
        </button>
      </div>

      {/*
        Named rather than implied. This uploads the whole document and supersedes
        what is in Cornerstone, so the attorney should know which version they
        are about to follow before they click, not after.
      */}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded bg-[color:var(--color-accent)] px-3 py-2 font-medium text-white disabled:opacity-50"
      >
        {saving
          ? 'Saving…'
          : current
            ? `Save this document as version ${current.versionNumber + 1}`
            : 'Save this document as a version'}
      </button>

      {message && <p className="text-[color:var(--color-ink-muted)]">{message}</p>}
      {error && <p className="text-red-600">{error}</p>}

      {history && history.versions.length > 0 && (
        <div className="space-y-1 border-t border-[color:var(--color-line)] pt-2">
          <p className="text-[11px] font-medium">History</p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {history.versions.map(version => (
              <li
                key={version.id}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className={version.id === history.currentVersionId ? 'font-medium' : ''}>
                  v{version.versionNumber} · {describeSource(version.source)}
                </span>
                <span className="shrink-0 text-[color:var(--color-ink-muted)]">
                  {new Date(version.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** The enum `document_versions.source` stores, in words an attorney uses. */
function describeSource(source: string): string {
  switch (source) {
    case 'generated':
      return 'generated'
    case 'assistant_edit':
      return 'assistant edit'
    case 'user_upload':
      return 'uploaded'
    case 'user_accept':
      return 'change accepted'
    case 'user_reject':
      return 'change rejected'
    case 'converted_pdf':
      return 'PDF conversion'
    default:
      return source.replaceAll('_', ' ')
  }
}

/**
 * Which Cornerstone document this file is.
 *
 * Chosen, never guessed from the filename. Estate matters routinely carry a
 * will and a trust whose filenames differ by a word, and a wrong guess here
 * would file an attorney's edits against the wrong document — visibly wrong
 * only much later.
 */
function DocumentPicker({
  matterId,
  onLink,
}: {
  matterId: string
  onLink: (document: LinkedDocument) => void
}) {
  const [rows, setRows] = useState<MatterDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listMatterDocuments(matterId)
      .then(result => {
        if (live) setRows(result.documents)
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load documents.')
      })
    return () => {
      live = false
    }
  }, [matterId])

  return (
    <div className="space-y-2 p-3">
      <p className="text-[color:var(--color-ink-muted)]">
        Which Cornerstone document is this? Linking lets you save it back as a new version.
      </p>

      {error && <p className="text-red-600">{error}</p>}
      {!rows && !error && <p className="text-[color:var(--color-ink-muted)]">Loading…</p>}
      {rows?.length === 0 && (
        <p className="text-[color:var(--color-ink-muted)]">
          This matter has no Word documents yet.
        </p>
      )}

      <ul className="space-y-1">
        {rows?.map(row => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() =>
                onLink({ id: row.id, name: row.name, baseVersionId: row.currentVersionId })
              }
              className="w-full rounded px-2 py-1 text-left hover:bg-[color:var(--color-surface-sunken)]"
            >
              <span className="block truncate font-medium">{row.name}</span>
              <span className="block text-[11px] text-[color:var(--color-ink-muted)]">
                {new Date(row.createdAt).toLocaleDateString()}
                {row.superseded && ' · superseded by a later draft'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
