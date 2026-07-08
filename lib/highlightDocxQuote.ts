/**
 * Citation quote helpers for in-app DOCX viewer highlighting.
 * Letters-only matching across rendered text nodes.
 */

export interface DocumentCitation {
  ref?: string
  documentId?: string
  page?: number | null
  quote: string
}

/** Normalize a quote segment to lowercase alphanumeric only. */
export function lettersOnly(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function splitQuoteSegments(quote: string): string[] {
  return quote
    .split(/\u2026|\.\.\./)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * Highlight matching quote segments inside a DOM root.
 * Wraps matches in <span class="docx-text-highlight">.
 * Returns the first highlighted element for scroll-into-view, or null.
 */
export function highlightDocxQuote(root: HTMLElement, quote: string): HTMLElement | null {
  // Clear prior highlights
  root.querySelectorAll('span.docx-text-highlight').forEach(span => {
    const parent = span.parentNode
    if (!parent) return
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
    parent.normalize()
  })

  const segments = splitQuoteSegments(quote)
    .map(lettersOnly)
    .filter(s => s.length >= 8)
  if (segments.length === 0) return null

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'STYLE' || tag === 'SCRIPT') return NodeFilter.FILTER_REJECT
      if (parent.closest('.star-pagination, .case-page-number')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) textNodes.push(n as Text)

  // Build global letters-only string + map back to (nodeIndex, charOffset)
  let global = ''
  const map: Array<{ nodeIndex: number; charOffset: number }> = []
  textNodes.forEach((node, nodeIndex) => {
    const value = node.nodeValue ?? ''
    for (let i = 0; i < value.length; i++) {
      const ch = value[i]!.toLowerCase()
      if (/[a-z0-9]/.test(ch)) {
        map.push({ nodeIndex, charOffset: i })
        global += ch
      }
    }
  })

  let firstHighlight: HTMLElement | null = null
  const ranges: Array<{ start: number; end: number }> = []

  for (const segment of segments) {
    const needle = segment.slice(0, Math.min(30, segment.length))
    const idx = global.indexOf(needle)
    if (idx < 0) continue
    const end = Math.min(idx + segment.length, global.length)
    ranges.push({ start: idx, end })
  }

  // Apply in reverse so splitText indices stay valid
  ranges.sort((a, b) => b.start - a.start)
  for (const range of ranges) {
    const startMap = map[range.start]
    const endMap = map[range.end - 1]
    if (!startMap || !endMap) continue

    if (startMap.nodeIndex === endMap.nodeIndex) {
      const node = textNodes[startMap.nodeIndex]!
      const el = wrapTextRange(node, startMap.charOffset, endMap.charOffset + 1)
      if (el) firstHighlight = el
    } else {
      for (let ni = endMap.nodeIndex; ni >= startMap.nodeIndex; ni--) {
        const node = textNodes[ni]
        if (!node) continue
        const start = ni === startMap.nodeIndex ? startMap.charOffset : 0
        const end =
          ni === endMap.nodeIndex ? endMap.charOffset + 1 : (node.nodeValue?.length ?? 0)
        const el = wrapTextRange(node, start, end)
        if (el) firstHighlight = el
      }
    }
  }

  return firstHighlight
}

function wrapTextRange(node: Text, start: number, end: number): HTMLElement | null {
  if (start >= end) return null
  const text = node.nodeValue ?? ''
  if (start < 0 || end > text.length) return null

  const mid = node.splitText(start)
  mid.splitText(end - start)
  const span = document.createElement('span')
  span.className = 'docx-text-highlight'
  span.style.backgroundColor = 'rgba(250, 204, 21, 0.45)'
  span.style.borderRadius = '2px'
  mid.parentNode?.insertBefore(span, mid)
  span.appendChild(mid)
  return span
}
