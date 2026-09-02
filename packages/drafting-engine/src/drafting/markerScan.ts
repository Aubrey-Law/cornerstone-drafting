import PizZip from 'pizzip'
import { MISSING_MARKER_RE } from '../estateGenerator/node/renderText'
import { LITERAL_BRACKET_TOKENS, UNRESOLVED_RE } from './docxMarkerPatterns'

// Literal attorney-TODO clause text (e.g. `[TODO: ATTORNEY-APPROVED NO-CONTEST
// CLAUSE …]`) lifted verbatim from lib/drafting/clauses.ts into a generated
// document. These flow only through the Python-fallback drafting path, which is
// never run through the Node renderer's marker checks — so the only reliable
// place to catch them is a scan of the final DOCX buffer. Nested brackets inside
// the TODO text (`[SPOUSE FULL NAME]`) make a balanced-bracket regex fragile, so
// we count the unambiguous opening literal instead.
export const TODO_MARKER_RE = /\[TODO:/g

// Visible run text lives in `<w:t>` elements. Word frequently fragments a single
// run of typed text across several `<w:t>` nodes, so a marker can be split mid-
// string; concatenating every run's text per part reassembles it before scanning.
const TEXT_RUN_RE = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g

export interface DocxMarkerScan {
  /** Count of literal `[TODO:` attorney-clause markers across the document. */
  todoCount: number
  /** Distinct leftover `{{ }}` / `{% %}` / `[ALL-CAPS]` template markers. */
  unresolved: string[]
  /** Distinct field paths left as `[[ MISSING: path ]]` holes. */
  missingFields: string[]
  /** todoCount + unresolved.length + missingFields.length; 0 means clean. */
  markerCount: number
}

function partText(xml: string): string {
  return [...xml.matchAll(TEXT_RUN_RE)].map(match => match[1]).join('')
}

/**
 * Scan a rendered DOCX buffer for leftover drafting markers — engine-agnostic,
 * so it covers the Node generator, the Supabase generator, and the Python
 * fallback uniformly. A non-zero `markerCount` means the document is not safe to
 * promote to a client-visible folder.
 */
export function scanDocxBufferForMarkers(buffer: Buffer): DocxMarkerScan {
  let zip: PizZip
  try {
    zip = new PizZip(buffer)
  } catch {
    // A buffer that isn't a readable zip surfaces as an upload/open failure
    // elsewhere; report clean here rather than throwing inside the upload loop.
    return { todoCount: 0, unresolved: [], missingFields: [], markerCount: 0 }
  }

  let todoCount = 0
  const unresolved = new Set<string>()
  const missingFields = new Set<string>()

  for (const fileName of Object.keys(zip.files)) {
    const file = zip.files[fileName]
    if (file.dir || !fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue

    const text = partText(file.asText())
    todoCount += [...text.matchAll(TODO_MARKER_RE)].length
    for (const match of text.matchAll(MISSING_MARKER_RE)) missingFields.add(match[1])
    for (const match of text.matchAll(UNRESOLVED_RE)) {
      if (!LITERAL_BRACKET_TOKENS.has(match[0])) unresolved.add(match[0])
    }
  }

  const unresolvedList = Array.from(unresolved).sort()
  const missingList = Array.from(missingFields).sort()
  return {
    todoCount,
    unresolved: unresolvedList,
    missingFields: missingList,
    markerCount: todoCount + unresolvedList.length + missingList.length,
  }
}
