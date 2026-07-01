import fs from 'node:fs'
import PizZip from 'pizzip'
import type { NodeClauseStore } from '@/lib/estateGenerator/node/clauses'
import type { NodeEstateContext } from '@/lib/estateGenerator/node/types'
import { MISSING_MARKER_RE, renderNodeEstateText } from '@/lib/estateGenerator/node/renderText'
import { UNRESOLVED_RE } from '@/lib/drafting/docxMarkerPatterns'
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
    .replaceAll('[CLIENT]', escapeXml(clientFooterName(context)))
    .replaceAll('[TRUST NAME]', escapeXml(trustName(context)))
    .replaceAll('[Double-Click to Insert Table of Contents]', 'Table of Contents')
}

const CONTROL_TAG_RE = /\{%[\s\S]*?%\}/g
const PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
const TEXT_RUN_RE = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g

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
  templatePath: string
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
  context,
  clauses,
}: RenderNodeEstateDocxTemplateArgs): RenderNodeEstateDocxTemplateResult {
  if (!fs.existsSync(templatePath)) throw new Error(`Template not found: ${templatePath}`)

  const zip = new PizZip(fs.readFileSync(templatePath))
  const unresolved = new Set<string>()
  const missingFields = new Set<string>()

  for (const fileName of Object.keys(zip.files)) {
    const file = zip.files[fileName]
    if (file.dir || !fileName.startsWith('word/') || !fileName.endsWith('.xml')) continue

    const rendered = replaceStaticMarkers(
      renderNodeEstateText(
        stripControlOnlyParagraphs(hoistParagraphConditionals(file.asText())),
        context,
        {
          include_clause: (clauseId: string, state?: string) => clauses.include(clauseId, context, state),
        },
        { autoescape: true },
      ),
      context,
    )

    // Collect the loud `[[ MISSING: field ]]` holes left for empty values so the
    // caller can report them, then strip the brackets from the regex below so
    // they are not also flagged as unresolved `{{ }}`/`[MARKER]` template text.
    for (const match of rendered.matchAll(MISSING_MARKER_RE)) {
      missingFields.add(match[1])
    }
    for (const match of rendered.matchAll(UNRESOLVED_RE)) {
      unresolved.add(match[0])
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
