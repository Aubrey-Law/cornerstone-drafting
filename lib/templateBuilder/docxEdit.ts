import PizZip from 'pizzip'

// ── DOCX text find/replace ────────────────────────────────────────────────────
// Rewrites literal text inside a DOCX (e.g. "[CLIENT NAME]" → "{{ client.full_name | name }}").
// Word frequently splits visible text across multiple <w:r> runs, so each
// replacement tries two strategies per XML part:
//   1. direct — the escaped text appears contiguously in the raw XML.
//   2. paragraph — concatenate the paragraph's <w:t> texts, replace in the
//      joined string, then write the whole result into the first run (the
//      paragraph keeps the first run's formatting; acceptable for form text).

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const PARAGRAPH_RE = /<w:p\b[\s\S]*?<\/w:p>/g
const TEXT_NODE_RE = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

function replaceInParagraph(paragraphXml: string, find: string, replace: string): { xml: string; count: number } {
  const nodes: Array<{ open: string; text: string; close: string }> = []
  for (const match of paragraphXml.matchAll(TEXT_NODE_RE)) {
    nodes.push({ open: match[1], text: decodeXml(match[2]), close: match[3] })
  }
  if (nodes.length === 0) return { xml: paragraphXml, count: 0 }

  const joined = nodes.map(node => node.text).join('')
  const count = countOccurrences(joined, find)
  if (count === 0) return { xml: paragraphXml, count: 0 }

  const replaced = joined.split(find).join(replace)
  let nodeIndex = 0
  const xml = paragraphXml.replace(TEXT_NODE_RE, (_full, open: string, _text: string, close: string) => {
    const isFirst = nodeIndex === 0
    nodeIndex++
    if (!isFirst) return `${open}${close}`
    const preserving = open.includes('xml:space') ? open : open.replace('<w:t', '<w:t xml:space="preserve"')
    return `${preserving}${escapeXml(replaced)}${close}`
  })
  return { xml, count }
}

export interface DocxReplacement {
  find: string
  replace: string
}

export interface DocxReplacementResult extends DocxReplacement {
  count: number
  method: 'direct' | 'paragraph' | 'not_found'
}

export interface ApplyDocxReplacementsResult {
  buffer: Buffer
  results: DocxReplacementResult[]
  applied: number
  notFound: number
}

/**
 * Apply literal text replacements across every word/*.xml part. Replacements
 * are applied in order; each reports how many occurrences were rewritten and
 * which strategy succeeded, so the caller can surface misses instead of
 * silently dropping them.
 */
export function applyDocxReplacements(templateBuffer: Buffer, replacements: DocxReplacement[]): ApplyDocxReplacementsResult {
  const zip = new PizZip(templateBuffer)
  const partNames = Object.keys(zip.files).filter(name => {
    const file = zip.files[name]
    return !file.dir && name.startsWith('word/') && name.endsWith('.xml')
  })
  const parts = new Map<string, string>(partNames.map(name => [name, zip.files[name].asText()]))
  const results: DocxReplacementResult[] = []

  for (const replacement of replacements) {
    const find = replacement.find
    if (!find) {
      results.push({ ...replacement, count: 0, method: 'not_found' })
      continue
    }
    let total = 0
    let usedParagraph = false
    const escapedFind = escapeXml(find)
    const escapedReplace = escapeXml(replacement.replace)

    for (const name of partNames) {
      let xml = parts.get(name)!
      const directCount = countOccurrences(xml, escapedFind)
      if (directCount > 0) {
        xml = xml.split(escapedFind).join(escapedReplace)
        total += directCount
        parts.set(name, xml)
        continue
      }
      // Fall back to paragraph-level joining for run-split text.
      let partCount = 0
      xml = xml.replace(PARAGRAPH_RE, paragraphXml => {
        const { xml: nextParagraph, count } = replaceInParagraph(paragraphXml, find, replacement.replace)
        partCount += count
        return nextParagraph
      })
      if (partCount > 0) {
        total += partCount
        usedParagraph = true
        parts.set(name, xml)
      }
    }

    results.push({
      ...replacement,
      count: total,
      method: total === 0 ? 'not_found' : usedParagraph ? 'paragraph' : 'direct',
    })
  }

  for (const [name, xml] of parts) {
    zip.file(name, xml)
  }

  return {
    buffer: Buffer.from(zip.generate({ type: 'uint8array', compression: 'DEFLATE' })),
    results,
    applied: results.filter(result => result.count > 0).length,
    notFound: results.filter(result => result.count === 0).length,
  }
}

/** Plain reading text of the document (paragraph per line) for LLM analysis. */
export function extractDocxParagraphText(templateBuffer: Buffer): string {
  const zip = new PizZip(templateBuffer)
  const lines: string[] = []
  for (const name of ['word/document.xml', ...Object.keys(zip.files).filter(n => /^word\/(header|footer)\d*\.xml$/.test(n))]) {
    const file = zip.files[name]
    if (!file || file.dir) continue
    for (const paragraph of file.asText().match(PARAGRAPH_RE) ?? []) {
      const texts: string[] = []
      for (const match of paragraph.matchAll(TEXT_NODE_RE)) {
        texts.push(decodeXml(match[2]))
      }
      const line = texts.join('')
      if (line.trim()) lines.push(line)
    }
  }
  return lines.join('\n')
}
