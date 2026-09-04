import PizZip from 'pizzip'
import { scanDocxBufferForMarkers } from '@/lib/drafting/markerScan'
import { loadR2Bytes } from '@/lib/documentApiHelpers'

/**
 * Whether a document may be shared with the client.
 *
 * `matter_documents.shared_at` is the only thing standing between a draft and
 * the client portal, and until now nothing checked what was in the document
 * first. `scanDocxBufferForMarkers` has always existed and always only
 * *reported*: `app/api/admin/matters/[id]/draft/route.ts` computes
 * `hasBlockingMarkers` beside a comment saying the hard block "lands in WP3",
 * which was never built. A Health Care Proxy with no agent phone numbers could
 * reach a client with nothing but a badge to say so.
 *
 * The gate is scoped to `[[ MISSING: path ]]` markers. Those are always
 * unintentional — the generator emits one where the design sheet had no value.
 * The blanks an attorney leaves on purpose (a signature line, a date to be
 * filled at execution) are not markers at all, so nothing here interferes with
 * them. `[TODO:` clause text and leftover `{{ }}` syntax still only warn.
 */

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type ShareCheck =
  | { shareable: true }
  | { shareable: false; reason: 'missing_fields'; missingFields: string[] }
  | { shareable: false; reason: 'unverifiable'; detail: string }

export interface ShareCandidate {
  r2_key: string
  name: string | null
  content_type: string | null
  source: string | null
  missing_count: number | null
}

function isDocx(doc: ShareCandidate): boolean {
  if (doc.content_type === DOCX_CONTENT_TYPE) return true
  return /\.docx$/i.test(doc.name ?? '')
}

/**
 * Reads the bytes a client would actually download.
 *
 * `matter_documents.r2_key` follows the current version — `createDocumentVersion`
 * repoints it — and the download route signs a URL for that same key. So this
 * scans what would be delivered, not what was generated at some earlier point.
 * That difference matters: a document fixed and re-uploaded outside the app has
 * a stale stored `missing_count`, and trusting it would block work that is
 * actually done.
 */
export async function checkDocumentShareable(doc: ShareCandidate): Promise<ShareCheck> {
  // A client's own upload cannot carry markers this firm's generator emits.
  if (doc.source === 'client') return { shareable: true }

  if (!isDocx(doc)) {
    // Everything else — a converted PDF above all — is judged by its recorded
    // count. `convert-pdf` copies the source document's, because a PDF render
    // of a marked-up document shows the markers just as plainly.
    const recorded = doc.missing_count ?? 0
    if (recorded > 0) {
      return {
        shareable: false,
        reason: 'missing_fields',
        missingFields: [`${recorded} unfilled field${recorded === 1 ? '' : 's'}`],
      }
    }
    return { shareable: true }
  }

  let bytes: Buffer
  try {
    bytes = await loadR2Bytes(doc.r2_key)
  } catch (error) {
    return {
      shareable: false,
      reason: 'unverifiable',
      detail: error instanceof Error ? error.message : 'could not read the document',
    }
  }

  // scanDocxBufferForMarkers reports clean on a buffer it cannot open — right
  // for a report that must not throw mid-upload, wrong for a gate, where
  // "unreadable" would silently become "nothing wrong with it". So the zip is
  // opened here first and a failure is its own answer.
  try {
    new PizZip(bytes)
  } catch {
    return {
      shareable: false,
      reason: 'unverifiable',
      detail: 'the file could not be opened as a Word document',
    }
  }

  const scan = scanDocxBufferForMarkers(bytes)
  if (scan.missingFields.length > 0) {
    return { shareable: false, reason: 'missing_fields', missingFields: scan.missingFields }
  }
  return { shareable: true }
}

/** What to tell the attorney, in terms of the document rather than the check. */
export function describeShareBlock(check: Extract<ShareCheck, { shareable: false }>): string {
  if (check.reason === 'unverifiable') {
    return `This document could not be checked for unfilled fields (${check.detail}), so it has not been shared. Try again, and if it keeps failing the file itself may be damaged.`
  }
  const fields = check.missingFields.join(', ')
  return `This document still has unfilled fields and has not been shared: ${fields}. Fill them in on the design sheet and regenerate, or upload a corrected copy.`
}
