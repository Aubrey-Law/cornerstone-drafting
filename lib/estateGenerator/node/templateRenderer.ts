import fs from 'node:fs'
import PizZip from 'pizzip'
import type { NodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import type { NodeEstateContext } from '@/lib/estateGenerator/node/types'
import { MISSING_MARKER_RE, renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { LITERAL_BRACKET_TOKENS, UNRESOLVED_RE } from '@/lib/drafting/docxMarkerPatterns'
import { getPath } from '@/lib/estateGenerator/node/validation'

// Re-export for callers that imported from this module historically.
export { UNRESOLVED_RE } from '@/lib/drafting/docxMarkerPatterns'

// Force every run/style font to Garamond, mirroring the Python al-generator's
// post-processing. The Word templates inherit a theme default (Aptos) and use
// "Times New Roman Bold" heading styles, so without this the Node generator
// leaves some sections in the wrong font. Applied to the body, headers/footers,
// and styles so both explicit run fonts and inherited defaults become Garamond.
const BODY_FONT_NAME = 'Garamond'
const RFONTS_RE = /<w:rFonts\b[^>]*\/>/g
const FONTS_NORMALIZED_PARTS = /^word\/(document\.xml|styles\.xml|(header|footer)\d*\.xml)$/

function normalizeFontsToGaramond(xml: string): string {
  return xml.replace(
    RFONTS_RE,
    `<w:rFonts w:ascii="${BODY_FONT_NAME}" w:hAnsi="${BODY_FONT_NAME}" w:cs="${BODY_FONT_NAME}"/>`,
  )
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Word often splits a single `{{ field }}` or `{% if %}` across several runs
 * (spell-check, manual edits), leaving OOXML tags inside the delimiter span.
 * Nunjucks then sees `{% if </w:t>` and throws "unexpected token: <". Rejoin the
 * tag so it is contiguous again.
 *
 * The split is not always inside one paragraph. A footer built from a table, or
 * a tag the author broke over two lines, puts the halves in different `<w:p>` or
 * different `<w:tc>` — so the scan crosses those boundaries, and the structural
 * XML is kept rather than stripped: deleting `</w:tc><w:tc>` to make the text
 * contiguous would merge two table cells and wreck the layout. The tag's text is
 * collected into the first run of the span instead, and the later runs are left
 * empty. Structure in, structure out.
 *
 * Scanning stops at the next opening delimiter, so an unclosed `{{` swallows
 * nothing: it is left exactly as it was for the renderer to report.
 */
export function repairSplitNunjucksInXml(xml: string): string {
  let result = ''
  let i = 0

  while (i < xml.length) {
    const opening = findVisibleOpening(xml, i)
    if (!opening) {
      result += xml.slice(i)
      break
    }

    result += xml.slice(i, opening.start)
    const closeToken = opening.kind === 'block' ? '%}' : '}}'
    const end = findVisibleTokenEnd(xml, opening.end, closeToken, xml.length)
    if (end === -1) {
      // Unclosed. Emit the delimiter itself and carry on from just after it, so
      // a stray brace cannot consume the tags that follow it.
      result += xml.slice(opening.start, opening.end)
      i = opening.end
      continue
    }

    const segment = xml.slice(opening.start, end)
    result += segment.includes('<') ? collapseSpanText(segment) : segment
    i = end
  }

  return result
}

/**
 * Move all of a span's visible text into its first text position, keeping every
 * XML tag where it was. `{{ client.` + `</w:t></w:r><w:r><w:t>` + `full_name }}`
 * becomes `{{ client.full_name }}` + `</w:t></w:r><w:r><w:t>` — one contiguous
 * tag, same run and paragraph structure, so nothing can be left unbalanced.
 */
function collapseSpanText(segment: string): string {
  const pieces: Array<{ tag: boolean; text: string }> = []
  let cursor = 0

  while (cursor < segment.length) {
    const next = segment.indexOf('<', cursor)
    if (next === -1) {
      pieces.push({ tag: false, text: segment.slice(cursor) })
      break
    }
    if (next > cursor) pieces.push({ tag: false, text: segment.slice(cursor, next) })
    const tagEnd = segment.indexOf('>', next + 1)
    if (tagEnd === -1) {
      pieces.push({ tag: false, text: segment.slice(next) })
      break
    }
    pieces.push({ tag: true, text: segment.slice(next, tagEnd + 1) })
    cursor = tagEnd + 1
  }

  const visible = pieces.filter(piece => !piece.tag).map(piece => piece.text).join('')
  let placed = false
  return pieces
    .map(piece => {
      if (piece.tag) return piece.text
      if (placed) return ''
      placed = true
      return visible
    })
    .join('')
}

function findVisibleOpening(
  xml: string,
  from: number,
): { start: number; end: number; kind: 'block' | 'variable' } | null {
  let openingBrace = -1

  for (let i = from; i < xml.length; i += 1) {
    if (xml[i] === '<') {
      const tagEnd = xml.indexOf('>', i + 1)
      if (tagEnd === -1) return null
      i = tagEnd
      continue
    }

    if (openingBrace !== -1) {
      if (xml[i] === '%') return { start: openingBrace, end: i + 1, kind: 'block' }
      if (xml[i] === '{') return { start: openingBrace, end: i + 1, kind: 'variable' }
      openingBrace = xml[i] === '{' ? i : -1
      continue
    }

    if (xml[i] === '{') openingBrace = i
  }

  return null
}

/**
 * Locate a token in the text Word displays while ignoring OOXML tags. Word can
 * put the first and second closing braces in different runs, for example
 * `}</w:t>...<w:t>}`. A raw `indexOf('}}')` cannot see that valid delimiter.
 *
 * Gives up on reaching another opening delimiter: a tag never contains one, so
 * hitting `{{` or `{%` means the tag being scanned was never closed, and
 * continuing would swallow every tag after it.
 */
function findVisibleTokenEnd(
  xml: string,
  from: number,
  token: string,
  limit: number,
): number {
  let matched = 0
  let brace = false

  for (let i = from; i < limit; i += 1) {
    if (xml[i] === '<') {
      const tagEnd = xml.indexOf('>', i + 1)
      if (tagEnd === -1 || tagEnd >= limit) return -1
      i = tagEnd
      continue
    }

    if (brace && (xml[i] === '{' || xml[i] === '%')) return -1
    brace = xml[i] === '{'

    if (xml[i] === token[matched]) {
      matched += 1
      if (matched === token.length) return i + 1
    } else {
      matched = xml[i] === token[0] ? 1 : 0
    }
  }

  return -1
}

/**
 * The first delimiter in the prepared XML that is never closed, as the text Word
 * shows rather than as markup. After the split-tag repair has run, anything
 * still open is an authoring mistake — a `{{` with no `}}`, usually because the
 * closing braces were deleted while editing.
 */
export function firstUnclosedTag(xml: string): string | null {
  let i = 0

  while (i < xml.length) {
    const opening = findVisibleOpening(xml, i)
    if (!opening) return null
    const closeToken = opening.kind === 'block' ? '%}' : '}}'
    const end = findVisibleTokenEnd(xml, opening.end, closeToken, xml.length)
    if (end === -1) {
      // Tags become spaces, not nothing, so text from two runs does not read as
      // one word in the message.
      const visible = xml.slice(opening.start, opening.start + 400).replace(/<[^>]+>/g, ' ')
      const shown = visible.replace(/\s+/g, ' ').trim().slice(0, 60)
      return shown.length === 60 ? `${shown}…` : shown
    }
    i = end
  }

  return null
}

function templatePartError(fileName: string, error: unknown, preparedXml?: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  const locatedMessage = message.replace('(unknown path)', fileName)
  // A line and column into one long line of OOXML tells the attorney nothing
  // about which merge field to fix. Name the tag instead.
  const unclosed = preparedXml ? firstUnclosedTag(preparedXml) : null
  const hint = unclosed
    ? ` — the tag "${unclosed}" is never closed; check for a missing ${unclosed.startsWith('{%') ? '%}' : '}}'}`
    : ''
  return new Error(`Template rendering failed in ${locatedMessage}${hint}`, { cause: error })
}

function clientFooterName(context: NodeEstateContext): string {
  const value = getPath(context, 'client.full_name')
  return value == null ? '' : String(value).toUpperCase()
}

function trustName(context: NodeEstateContext): string {
  const value = getPath(context, 'trust.name')
  return value == null ? '' : String(value).toUpperCase()
}

function replaceStaticMarkers(xml: string, context: NodeEstateContext): string {
  return xml
    .replaceAll('[CLIENT FULL NAME]', escapeXml(clientFooterName(context)))
    .replaceAll('[CLIENT]', escapeXml(clientFooterName(context)))
    .replaceAll('[TRUST NAME]', escapeXml(trustName(context)))
    .replaceAll('[Double-Click to Insert Table of Contents]', 'Table of Contents')
}

const CONTROL_TAG_RE = /\{%[\s\S]*?%\}/g
const PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
const TABLE_ROW_RE = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g
const TEXT_RUN_RE = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
const EXACT_TEXT_RUN_RE = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g

// docxtpl's `{%tr ... %}` convention puts an opening/closing loop directive in
// its own table row. That marker row is removed, and the normalized Nunjucks
// directive governs the data row(s) between the two markers. Nunjucks itself
// does not know the `tr` prefix and otherwise throws "unknown block tag: tr".
// Only a row whose entire visible text is one `{%tr ... %}` directive is
// transformed, so ordinary table content cannot be removed accidentally.
export function hoistTableRowControls(xml: string): string {
  return xml.replace(TABLE_ROW_RE, row => {
    const text = [...row.matchAll(EXACT_TEXT_RUN_RE)].map(match => match[1]).join('').trim()
    const directive = /^\{%\s*tr\s+([\s\S]*?)\s*%\}$/.exec(text)
    return directive ? `{% ${directive[1].trim()} %}` : row
  })
}

// Count of `<w:NAME>` opening tags that require a matching `</w:NAME>`, minus
// the closing tags — i.e. zero when balanced. `\b` keeps `<w:p>` from matching
// `<w:pPr>`; self-closing `<w:NAME …/>` tags need no close, so they are excluded.
function tagImbalance(xml: string, name: string): number {
  const total = (xml.match(new RegExp(`<w:${name}\\b`, 'g')) ?? []).length
  const selfClosing = (xml.match(new RegExp(`<w:${name}\\b[^>]*/>`, 'g')) ?? []).length
  const closes = xml.split(`</w:${name}>`).length - 1
  return (total - selfClosing) - closes
}

function isStructurallyBalanced(xml: string): boolean {
  return tagImbalance(xml, 'p') === 0
    && tagImbalance(xml, 'r') === 0
    && tagImbalance(xml, 't') === 0
    && tagImbalance(xml, 'tbl') === 0
    && tagImbalance(xml, 'tr') === 0
    && tagImbalance(xml, 'tc') === 0
}

// A standalone {% if %}/{% endif %}/{% for %} tag authored in its own Word
// paragraph leaves an empty paragraph (a blank line) in the output even when its
// block is kept or skipped. Unwrap any paragraph whose entire visible text is
// only control tag(s) so the tag governs the surrounding paragraphs without
// leaving a blank line of its own — this is what collapses the gap when a
// conditional section (e.g. a withheld POA article) is omitted. Paragraphs that
// also contain real text or {{ placeholders }} are left untouched.
function stripControlOnlyParagraphs(xml: string): string {
  const stripped = xml.replace(PARAGRAPH_RE, paragraph => {
    const text = [...paragraph.matchAll(TEXT_RUN_RE)].map(match => match[1]).join('')
    const tags = text.match(CONTROL_TAG_RE)
    if (!tags) return paragraph
    if (text.replace(CONTROL_TAG_RE, '').trim() !== '') return paragraph
    return tags.join('')
  })
  // Safety net: PARAGRAPH_RE is non-greedy, so a template authored with a
  // paragraph malformed-nested inside a run (`<w:r><w:p>…`) can make the match
  // unwrap the wrong span and unbalance the document. Only accept the result if
  // it preserved tag balance; otherwise keep the original XML so the document
  // still opens (it just keeps the blank line the strip would have removed).
  return isStructurallyBalanced(stripped) ? stripped : xml
}

const CONTROL_TOKEN_RE = /\{%\s*(if|elif|else|endif|for|endfor)\b[\s\S]*?%\}/g

// When a paragraph's entire visible text is a single `{% if … %}…{% endif %}`
// block (e.g. `{% if has_pet_care %}{{ include_clause("will.pet_care") }}{% endif %}`),
// a false condition renders the paragraph empty and leaves a blank line. This
// detects that shape and returns the exact opening/closing tag literals so the
// caller can move them outside the `<w:p>`. Returns null when the paragraph is
// not a clean fully-conditional block — there is text outside the block, the
// outer block has a top-level `{% else %}`/`{% elif %}`, or it is two sibling
// blocks — so those paragraphs are left untouched.
function fullyConditionalBlock(visibleText: string): { open: string; close: string } | null {
  const trimmed = visibleText.trim()
  if (!trimmed) return null
  const tokens = [...trimmed.matchAll(CONTROL_TOKEN_RE)]
  if (tokens.length < 2) return null

  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  if (first[1] !== 'if' || last[1] !== 'endif') return null
  // Nothing may sit outside the block (otherwise hoisting would drop real text).
  if (first.index !== 0) return null
  if ((last.index ?? 0) + last[0].length !== trimmed.length) return null

  // The opening `if` must pair with the final `endif`: `if`-depth stays >= 1
  // through every intermediate token and only returns to 0 at the last token.
  // A top-level `else`/`elif` is rejected because hoisting only the outer
  // `if`/`endif` would orphan it.
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const kind = tokens[i][1]
    if (kind === 'if') depth += 1
    else if (kind === 'endif') depth -= 1
    else if ((kind === 'else' || kind === 'elif') && depth === 1) return null
    if (depth < 0) return null
    if (depth === 0 && i !== tokens.length - 1) return null
  }
  if (depth !== 0) return null

  return { open: first[0], close: last[0] }
}

// Move a fully-conditional paragraph's `{% if %}`/`{% endif %}` outside its
// `<w:p>` so Nunjucks drops the entire paragraph — and its blank line — when the
// condition is false. When the condition is true the paragraph renders exactly
// as before (the hoisted tags render to nothing either way). Applied to every
// template, so any document authored with `{% if cond %}…{% endif %}` standalone
// paragraphs collapses cleanly when the section is omitted.
export function hoistParagraphConditionals(xml: string): string {
  const hoisted = xml.replace(PARAGRAPH_RE, paragraph => {
    const text = [...paragraph.matchAll(TEXT_RUN_RE)].map(match => match[1]).join('')
    const block = fullyConditionalBlock(text)
    if (!block) return paragraph

    // Tags must appear contiguously in the paragraph XML to be relocated safely
    // (they do unless Word split them across runs, in which case we leave the
    // paragraph alone rather than risk corrupting it).
    const openIdx = paragraph.indexOf(block.open)
    if (openIdx === -1) return paragraph
    const withoutOpen = paragraph.slice(0, openIdx) + paragraph.slice(openIdx + block.open.length)
    const closeIdx = withoutOpen.lastIndexOf(block.close)
    if (closeIdx === -1) return paragraph
    const inner = withoutOpen.slice(0, closeIdx) + withoutOpen.slice(closeIdx + block.close.length)

    return `${block.open}${inner}${block.close}`
  })
  // Hoisting never adds or removes `<w:p>` tags, but guard against a mis-spanned
  // PARAGRAPH_RE match (malformed nesting) the same way stripControlOnlyParagraphs does.
  return isStructurallyBalanced(hoisted) ? hoisted : xml
}

export interface RenderNodeEstateDocxTemplateArgs {
  templatePath?: string
  templateBuffer?: Buffer
  context: NodeEstateContext
  clauses: NodeClauseStore
}

export interface RenderNodeEstateDocxTemplateResult {
  buffer: Buffer
  unresolvedMarkers: string[]
  missingFields: string[]
}

export function renderNodeEstateDocxTemplate({
  templatePath,
  templateBuffer,
  context,
  clauses,
}: RenderNodeEstateDocxTemplateArgs): RenderNodeEstateDocxTemplateResult {
  if (!templateBuffer && (!templatePath || !fs.existsSync(templatePath))) {
    throw new Error(`Template not found: ${templatePath ?? '(no path provided)'}`)
  }

  const zip = new PizZip(templateBuffer ?? fs.readFileSync(templatePath!))
  const unresolved = new Set<string>()
  const missingFields = new Set<string>()

  for (const fileName of Object.keys(zip.files)) {
    const file = zip.files[fileName]
    if (file.dir || !fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue

    const prepared = repairSplitNunjucksInXml(
      stripControlOnlyParagraphs(
        hoistParagraphConditionals(hoistTableRowControls(file.asText())),
      ),
    )

    let rendered: string
    try {
      rendered = replaceStaticMarkers(
        renderNodeEstateText(
          prepared,
          context,
          {
            include_clause: (clauseId: string, state?: string) => clauses.include(clauseId, context, state),
          },
          { autoescape: true },
        ),
        context,
      )
    } catch (error) {
      throw templatePartError(fileName, error, prepared)
    }

    // Collect the loud `[[ MISSING: field ]]` holes left for empty values so the
    // caller can report them, then strip the brackets from the regex below so
    // they are not also flagged as unresolved `{{ }}`/`[MARKER]` template text.
    for (const match of rendered.matchAll(MISSING_MARKER_RE)) {
      missingFields.add(match[1])
    }
    for (const match of rendered.matchAll(UNRESOLVED_RE)) {
      if (!LITERAL_BRACKET_TOKENS.has(match[0])) unresolved.add(match[0])
    }

    const finalXml = FONTS_NORMALIZED_PARTS.test(fileName)
      ? normalizeFontsToGaramond(rendered)
      : rendered
    zip.file(fileName, finalXml)
  }

  return {
    buffer: Buffer.from(zip.generate({ type: 'uint8array', compression: 'DEFLATE' })),
    unresolvedMarkers: Array.from(unresolved).sort(),
    missingFields: Array.from(missingFields).sort(),
  }
}
